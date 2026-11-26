import { and, eq, isNotNull } from 'drizzle-orm';
import type { Event } from 'nostr-tools';

import { db } from '@/db/client';
import { conversations, privateListSyncState, replaceableEvents } from '@/db/schema';
import { MESSAGE_EXPIRY_SETTINGS_D, MESSAGE_EXPIRY_SETTINGS_KIND, validExpiryDuration } from '@/lib/nostr/disappearing-message';
import type { Signer } from '@/services/signer/signer.interface';

import { markPrivateListDirty, queuePrivateListPublication, readPrivateListState } from '../relay/private-list-sync.service';
import { storeReplaceableEvent } from '../relay/replaceable-events.service';
import {
  DEFAULT_MESSAGE_EXPIRY_SLOT, decodeMessageExpirySettings, messageExpirySettingsQuery, readExpirySettings,
  type MessageExpiryValues, validExpiryConversationKey,
} from './message-expiry-preference';

const incomingCacheWrites = new Map<string, Promise<void>>();

function encode(values: MessageExpiryValues): string[][] {
  return [['v', '1'], ['default', String(values.get(DEFAULT_MESSAGE_EXPIRY_SLOT) ?? 0)],
    ...Array.from(values).filter(([key]) => key !== DEFAULT_MESSAGE_EXPIRY_SLOT).sort(([a], [b]) => a.localeCompare(b))
      .map(([key, value]) => ['conversation', key, String(value)])];
}

export function queueMessageExpiryPublication(accountPubkey: string, signer?: Signer): void {
  queuePrivateListPublication({
    accountPubkey, kind: MESSAGE_EXPIRY_SETTINGS_KIND, dTag: MESSAGE_EXPIRY_SETTINGS_D, signer,
    pendingCacheWrite: () => incomingCacheWrites.get(accountPubkey),
    reconcileCachedEvent: (event, signer) => applyMessageExpirySettingsEvent(accountPubkey, event, signer, {
      throwOnDecryptError: true,
    }),
    validateTags: tags => {
      const values = decodeMessageExpirySettings(tags);
      if (!values) throw new Error('Invalid message expiry settings draft');
      return encode(values);
    },
  });
}

/** Register a verified subscription event before yielding to a signer. */
export function cacheMessageExpirySettingsEvent(event: Event): Promise<void> {
  const accountPubkey = event.pubkey;
  const prior = incomingCacheWrites.get(accountPubkey) ?? Promise.resolve();
  const write = prior.catch(() => {}).then(async () => { await storeReplaceableEvent(event); });
  incomingCacheWrites.set(accountPubkey, write);
  const clear = () => {
    if (incomingCacheWrites.get(accountPubkey) === write) incomingCacheWrites.delete(accountPubkey);
  };
  void write.then(() => {
    clear();
    return resumeMessageExpiryPublication(accountPubkey);
  }, clear).catch(() => {});
  return write;
}

export async function resumeMessageExpiryPublication(accountPubkey: string): Promise<void> {
  const [state] = await messageExpirySettingsQuery(accountPubkey);
  if (state?.dirty) queueMessageExpiryPublication(accountPubkey);
}

export async function setMessageExpirySetting(accountPubkey: string, key: string | null, seconds: number | null): Promise<void> {
  if (!accountPubkey || (key !== null && !validExpiryConversationKey.test(key)) ||
      (seconds !== null && !validExpiryDuration(seconds)) || (key === null && seconds === null)) {
    throw new Error('Invalid message expiry preference');
  }
  await db.transaction(async tx => {
    const state = await readPrivateListState(accountPubkey, MESSAGE_EXPIRY_SETTINGS_D, tx, MESSAGE_EXPIRY_SETTINGS_KIND);
    let values = readExpirySettings(state);
    if (!values) {
      values = new Map([[DEFAULT_MESSAGE_EXPIRY_SLOT, 0]]);
      const legacy = await tx.select({
        key: conversations.conversationKey, duration: conversations.disappearAfterSeconds,
      }).from(conversations).where(and(eq(conversations.accountPubkey, accountPubkey), isNotNull(conversations.disappearAfterSeconds)));
      for (const row of legacy) {
        if (validExpiryConversationKey.test(row.key) && row.duration != null && validExpiryDuration(row.duration)) {
          values.set(row.key, row.duration);
        }
      }
    }
    if (seconds === null) values.delete(key!);
    else values.set(key ?? DEFAULT_MESSAGE_EXPIRY_SLOT, seconds);
    await markPrivateListDirty(accountPubkey, MESSAGE_EXPIRY_SETTINGS_D, tx, MESSAGE_EXPIRY_SETTINGS_KIND, encode(values));
  });
  queueMessageExpiryPublication(accountPubkey);
}

export async function applyMessageExpirySettingsEvent(
  accountPubkey: string,
  event: Event | null,
  signer: Signer,
  options: { throwOnDecryptError?: boolean } = {},
): Promise<void> {
  if (!event || event.pubkey !== accountPubkey || event.kind !== MESSAGE_EXPIRY_SETTINGS_KIND ||
      event.tags.find(([key]) => key === 'd')?.[1] !== MESSAGE_EXPIRY_SETTINGS_D) return;
  let plaintext: string;
  try {
    if (!signer.nip44Decrypt) throw new Error('Message expiry settings require NIP-44 decryption');
    plaintext = await signer.nip44Decrypt(accountPubkey, event.content);
  } catch (error) {
    if (options.throwOnDecryptError) throw error;
    return;
  }
  let remote: MessageExpiryValues | null;
  try {
    remote = decodeMessageExpirySettings(JSON.parse(plaintext));
  } catch {
    return;
  }
  if (!remote) return;
  const remoteTags = encode(remote);
  await storeReplaceableEvent(event);
  const dirty = await db.transaction(async tx => {
    const coordinate = {
      accountPubkey, kind: MESSAGE_EXPIRY_SETTINGS_KIND, dTag: MESSAGE_EXPIRY_SETTINGS_D,
    };
    const cached = await tx.select({ event: replaceableEvents.event }).from(replaceableEvents).where(and(
      eq(replaceableEvents.pubkey, accountPubkey), eq(replaceableEvents.kind, coordinate.kind), eq(replaceableEvents.dTag, coordinate.dTag),
    )).get();
    if (cached?.event?.id !== event.id) return false;
    const state = await readPrivateListState(accountPubkey, coordinate.dTag, tx, coordinate.kind);
    if (state?.eventId === event.id) return state.dirty;
    const snapshot = { eventId: event.id, tags: remoteTags };
    const localDraft = state?.dirty && decodeMessageExpirySettings(state.draft);
    let draft: string[][] | null = null;
    if (localDraft) {
      const base = decodeMessageExpirySettings(state?.snapshot?.tags) ?? new Map([[DEFAULT_MESSAGE_EXPIRY_SLOT, 0]]);
      for (const key of new Set([...base.keys(), ...localDraft.keys()])) {
        const value = localDraft.get(key);
        if (value === base.get(key)) continue;
        if (value === undefined) remote.delete(key);
        else remote.set(key, value);
      }
      draft = encode(remote);
    }
    const next = { eventId: event.id, snapshot, draft, dirty: draft !== null, revision: (state?.revision ?? 0) + 1 };
    await tx.insert(privateListSyncState).values({ ...coordinate, ...next }).onConflictDoUpdate({
      target: [privateListSyncState.accountPubkey, privateListSyncState.kind, privateListSyncState.dTag],
      set: next,
    });
    return draft !== null;
  });
  if (dirty) queueMessageExpiryPublication(accountPubkey, signer);
}
