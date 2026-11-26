import { sql } from 'drizzle-orm';
import { finalizeEvent, generateSecretKey, getPublicKey, nip44 } from 'nostr-tools';
import { readFileSync } from 'node:fs';

import { db } from '@/db/client';
import { MESSAGE_EXPIRY_SETTINGS_D, MESSAGE_EXPIRY_SETTINGS_KIND } from '@/lib/nostr/disappearing-message';
import { enqueueConfigurationEvent } from '@/services/relay/configuration-publish.service';
import { storeReplaceableEvent } from '@/services/relay/replaceable-events.service';

import { authoredExpirationTags, messageExpirySettingsQuery, readExpirySettings } from '../message-expiry-preference';
import { applyMessageExpirySettingsEvent, resumeMessageExpiryPublication, setMessageExpirySetting } from '../message-expiry-sync';

jest.mock('@/db/client', () => {
  const { applicationTestDatabase } = jest.requireActual('@/services/explore/testing/database');
  return { db: applicationTestDatabase().db };
});
jest.mock('@/services/account/account.service', () => ({ buildSigner: async () => mockSigner }));
jest.mock('@/services/relay/configuration-publish.service', () => ({ enqueueConfigurationEvent: jest.fn() }));
jest.mock('@/services/relay/relay-pool', () => ({ relayPool: {} }));

const secret = generateSecretKey();
const self = getPublicKey(secret);
const group = `group:${'b'.repeat(64)}`;
const peer = 'c'.repeat(64);
const nearby = 'd'.repeat(64);
const conversationKey = nip44.v2.utils.getConversationKey(secret, self);
const mockSigner = {
  getPublicKey: async () => self,
  nip44Encrypt: async (_peer: string, plaintext: string) => nip44.v2.encrypt(plaintext, conversationKey),
  nip44Decrypt: async (_peer: string, ciphertext: string) => nip44.v2.decrypt(ciphertext, conversationKey),
  signEvent: async (template: Parameters<typeof finalizeEvent>[0]) => finalizeEvent(template, secret),
};

function remote(created_at: number, seconds: number, extras: string[][] = []) {
  return finalizeEvent({
    kind: MESSAGE_EXPIRY_SETTINGS_KIND,
    created_at,
    tags: [['d', MESSAGE_EXPIRY_SETTINGS_D]],
    content: nip44.v2.encrypt(JSON.stringify([['v', '1'], ['default', String(seconds)], ...extras]), conversationKey),
  }, secret);
}

beforeAll(async () => {
  await db.run(sql`INSERT INTO accounts (pubkey) VALUES (${self})`);
  await db.run(sql`CREATE TABLE conversations (account_pubkey TEXT, conversation_key TEXT, disappear_after_seconds INTEGER)`);
  for (const migration of [
    '0045_configuration-outbox', '0086_routing-settings-edits', '0087_relay-publish-retries',
  ]) {
    const source = readFileSync(`src/db/migrations/${migration}.sql`, 'utf8');
    for (const statement of source.split('--> statement-breakpoint')) {
      if (statement.trim()) await db.run(sql.raw(statement));
    }
  }
});

beforeEach(async () => {
  jest.mocked(enqueueConfigurationEvent).mockReset();
  await db.run(sql`DELETE FROM configuration_outbox`);
  await db.run(sql`DELETE FROM private_list_sync_state`);
  await db.run(sql`DELETE FROM replaceable_events`);
  const { invalidateReplaceableEvent } = jest.requireActual('@/services/relay/replaceable-events.service');
  invalidateReplaceableEvent({ pubkey: self, kind: MESSAGE_EXPIRY_SETTINGS_KIND, dTag: MESSAGE_EXPIRY_SETTINGS_D });
});

it('encrypts the config for its own account, applies newer snapshots and rebases pending edits', async () => {
  jest.useFakeTimers({ now: 2_000_000 });
  try {
    jest.mocked(enqueueConfigurationEvent).mockImplementation(async (event, commit) => {
      await storeReplaceableEvent(event);
      await db.transaction(async tx => { await commit?.(event, tx); });
      return true;
    });
    await setMessageExpirySetting(self, null, 2_419_200);
    await expect(setMessageExpirySetting(self, group, 0)).rejects.toThrow('Invalid message expiry preference');
    await setMessageExpirySetting(self, nearby, 0);
    await jest.runAllTimersAsync();
    const [event] = jest.mocked(enqueueConfigurationEvent).mock.calls[0];
    expect(event).toMatchObject({ pubkey: self, kind: 30078, tags: [['d', MESSAGE_EXPIRY_SETTINGS_D]] });
    expect(event.content).not.toContain(group);
    expect(JSON.parse(await mockSigner.nip44Decrypt(self, event.content))).toEqual([
      ['v', '1'], ['default', '2419200'], ['conversation', nearby, '0'],
    ]);
    await expect(authoredExpirationTags(self, group, 10)).resolves.toEqual([]);
    await expect(authoredExpirationTags(self, peer, 10)).resolves.toEqual([['expiration', '2419210']]);

    await setMessageExpirySetting(self, nearby, 45);
    await applyMessageExpirySettingsEvent(self, remote(2100, 600, [
      ['conversation', peer, '0'], ['conversation', group, '45'],
    ]), mockSigner);
    expect(readExpirySettings((await messageExpirySettingsQuery(self))[0])?.has(group)).toBe(false);
    await expect(authoredExpirationTags(self, group, 10)).resolves.toEqual([]);
    await expect(authoredExpirationTags(self, nearby, 10)).resolves.toEqual([['expiration', '55']]);
    await expect(authoredExpirationTags(self, peer, 10)).resolves.toEqual([]);
    await jest.runAllTimersAsync();

    const older = remote(2099, 10);
    await applyMessageExpirySettingsEvent(self, older, mockSigner);
    expect(readExpirySettings((await messageExpirySettingsQuery(self))[0])?.get('')).toBe(600);
    await setMessageExpirySetting(self, nearby, null);
    await expect(authoredExpirationTags(self, nearby, 10)).resolves.toEqual([['expiration', '610']]);
    await jest.runAllTimersAsync();
  } finally {
    jest.useRealTimers();
  }
});

it.each([false, true])('merges a startup-cached snapshot before publication, decrypt retries: %s', async retry => {
  jest.useFakeTimers({ now: 2_000_000 });
  const real = jest.requireActual<typeof import('@/services/relay/configuration-publish.service')>(
    '@/services/relay/configuration-publish.service',
  );
  const wake = jest.spyOn(real.configurationPublisher, 'wake').mockImplementation(() => {});
  const decrypt = jest.spyOn(mockSigner, 'nip44Decrypt');
  try {
    let notify!: (accepted: boolean) => void;
    const committed = new Promise<boolean>(resolve => { notify = resolve; });
    jest.mocked(enqueueConfigurationEvent).mockImplementation(async (...args) => {
      const accepted = await real.enqueueConfigurationEvent(...args);
      notify(accepted);
      return accepted;
    });
    await applyMessageExpirySettingsEvent(self, remote(1900, 60), mockSigner);
    await setMessageExpirySetting(self, nearby, 45);
    // The startup read has cached this event, but has not applied its plaintext.
    const incoming = remote(2100, 600, [['conversation', peer, '0']]);
    await storeReplaceableEvent(incoming);
    if (retry) {
      decrypt.mockRejectedValueOnce(new Error('Signer temporarily unavailable'));
      await jest.runAllTimersAsync();
      expect(enqueueConfigurationEvent).not.toHaveBeenCalled();
      expect((await messageExpirySettingsQuery(self))[0]?.dirty).toBe(true);
      await resumeMessageExpiryPublication(self);
    }
    await jest.runAllTimersAsync();
    await expect(committed).resolves.toBe(true);
    expect(enqueueConfigurationEvent).toHaveBeenCalledTimes(1);
    const [published, , previous] = jest.mocked(enqueueConfigurationEvent).mock.calls[0];
    expect(previous).toBe(incoming.id);
    expect(published.created_at).toBe(2101);
    expect(JSON.parse(await mockSigner.nip44Decrypt(self, published.content))).toEqual([
      ['v', '1'], ['default', '600'], ['conversation', peer, '0'], ['conversation', nearby, '45'],
    ]);
    expect((await messageExpirySettingsQuery(self))[0]?.dirty).toBe(false);
  } finally {
    decrypt.mockRestore();
    wake.mockRestore();
    jest.useRealTimers();
  }
});
