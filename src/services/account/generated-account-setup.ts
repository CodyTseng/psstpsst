import { DISCOVERY_RELAYS, normalizeRelayUrl } from '@/lib/nostr/relay-url';

import type { MessagingMetadata } from '../dm/messaging-metadata';
import {
  generateEncryptionKeypair,
  getEncryptionPubkeyFromEvent,
  loadEncryptionKeys,
  publishEncryptionKeyAnnouncement,
} from '../dm/encryption-key.service';
import { loadAccountDmRelays, saveAndPublishDmRelays } from '../relay/relay-list.service';
import { prepareConfiguration, publishConfiguration } from '../relay/configuration-publish.service';
import { configurationPublishRelays } from '../relay/relay-router';
import { getReplaceableEvents } from '../relay/replaceable-events.service';
import { createSigner } from '../signer/signer-factory';
import { completeGeneratedAccountSetup, getAccount, setAccountEncryptionPubkey } from './account.service';

/** Resume only a proven local creation. The marker survives interruption and is
 * never inferred from an empty relay response or a missing local key. */
export function initializeGeneratedAccount(
  accountPubkey: string, abort: AbortSignal,
): Promise<MessagingMetadata> {
  // Serialize interrupted/restarted attempts and let the boot UI paint before crypto.
  return prepareConfiguration(accountPubkey, 10044, '', () => finishLocalSetup(accountPubkey, abort));
}

async function finishLocalSetup(accountPubkey: string, abort: AbortSignal): Promise<MessagingMetadata> {
  const checkCurrent = () => {
    if (abort.aborted) throw new Error('Account bootstrap was cancelled.');
  };
  checkCurrent();
  const account = await getAccount(accountPubkey);
  if (account?.signerType !== 'generated' || !account.localSetupPending) {
    throw new Error('The account is not awaiting local creation setup.');
  }
  const signer = await createSigner({
    accountPubkey, signerType: account.signerType, signerPayload: account.signerPayload,
  });
  const keys = await loadEncryptionKeys(accountPubkey);
  checkCurrent();
  // An interrupted setup may already hold its key. Never rotate it on retry.
  const key = keys[0] ?? await generateEncryptionKeypair(accountPubkey);
  checkCurrent();
  await setAccountEncryptionPubkey(accountPubkey, key.pubkey);
  const metadataKeys = [10044, 10050, 10002].map((kind) => ({ pubkey: accountPubkey, kind }));
  const [announcement, inbox, outbox] = await getReplaceableEvents(metadataKeys);
  checkCurrent();
  if (!announcement || getEncryptionPubkeyFromEvent(announcement) !== key.pubkey) {
    await publishEncryptionKeyAnnouncement({ signer, encryptionPubkey: key.pubkey, relays: [] });
  }
  checkCurrent();
  const dmRelays = await loadAccountDmRelays(accountPubkey);
  checkCurrent();
  if (!inbox) {
    await saveAndPublishDmRelays({ accountPubkey, signer, relays: dmRelays });
  }
  checkCurrent();
  // Only local account creation initializes NIP-65 defaults. Resuming setup
  // preserves an existing declaration independently of the DM inbox list.
  if (!outbox) {
    await publishConfiguration(accountPubkey, signer, {
      kind: 10002,
      content: '',
      tags: DISCOVERY_RELAYS.map((url) => ['r', normalizeRelayUrl(url), 'write']),
      created_at: Math.floor(Date.now() / 1000),
    }, undefined, null);
  }
  checkCurrent();
  const [localAnnouncement] = await getReplaceableEvents([metadataKeys[0]]);
  if (!localAnnouncement || getEncryptionPubkeyFromEvent(localAnnouncement) !== key.pubkey) {
    throw new Error('The local encryption-key announcement was not persisted.');
  }
  const announcementRelays = await configurationPublishRelays(localAnnouncement);
  checkCurrent();
  await completeGeneratedAccountSetup(accountPubkey);
  checkCurrent();
  return { accountPubkey, dmRelays, announcementRelays, announcement: localAnnouncement };
}
