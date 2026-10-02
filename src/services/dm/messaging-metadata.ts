import type { Event } from 'nostr-tools';

import { DISCOVERY_RELAYS, normalizeRelayUrl } from '@/lib/nostr/relay-url';

import {
  KIND_DM_RELAY_LIST,
  KIND_ENCRYPTION_KEY_ANNOUNCEMENT,
  KIND_RELAY_LIST_METADATA,
} from '../crypto/nip17-gift-wrap';
import { enqueueConfigurationEvent } from '../relay/configuration-publish.service';
import { applyOwnDmRelayListEvent, loadAccountDmRelays } from '../relay/relay-list.service';
import { relayPool } from '../relay/relay-pool';
import { RelayQueryError } from '../relay/relay-query-error';
import type { QueryRelayResult, SignAuth } from '../relay/managed-relay-pool';
import { parseRelayListMetadata } from '../relay/relay-router';
import { getReplaceableEvents, storeReplaceableEvent } from '../relay/replaceable-events.service';
import { getEncryptionPubkeyFromEvent, loadEncryptionKeys } from './encryption-key.service';

const METADATA_KINDS = [
  KIND_RELAY_LIST_METADATA,
  KIND_DM_RELAY_LIST,
  KIND_ENCRYPTION_KEY_ANNOUNCEMENT,
];
const MAX_DISCOVERY_ROUNDS = 4;

export type MessagingMetadata = {
  accountPubkey: string;
  dmRelays: string[];
  announcementRelays: string[];
  announcement: Event | null;
};

export { MessagingKeySyncRequiredError } from './receive-session';

export class MessagingMetadataUnavailableError extends Error {
  constructor(readonly relayResults: QueryRelayResult[]) {
    super('No relay completed the messaging metadata lookup.');
    this.name = 'MessagingMetadataUnavailableError';
  }
}

export function isNewerAnnouncement(incoming: Event, current: Event | null): boolean {
  return !current || incoming.created_at > current.created_at ||
    (incoming.created_at === current.created_at && incoming.id < current.id);
}

async function signMissingConfiguration(
  accountPubkey: string,
  kind: number,
  tags: string[][],
  signAuth: SignAuth,
): Promise<Event> {
  const event = await signAuth({
    kind,
    content: '',
    tags,
    created_at: Math.floor(Date.now() / 1000),
  });
  if (event.pubkey !== accountPubkey || event.kind !== kind) {
    throw new Error('Messaging configuration signer does not match the account.');
  }
  try {
    await enqueueConfigurationEvent(event, undefined, null);
    return event;
  } catch (error) {
    // A settings edit may have filled this coordinate while a remote signer was
    // producing the repair. That newer durable snapshot already owns publication;
    // use it instead of failing account startup or overwriting it.
    const [current] = await getReplaceableEvents([{ pubkey: accountPubkey, kind }]);
    if (current) return current;
    throw error;
  }
}

/** Refresh routing and keys together, following newly discovered inbox/outbox
 * relays before declaring the account ready. Cached events are freshness floors,
 * never substitutes for a completed network lookup. At least one relay must
 * finish its query, while unavailable replicas and newly advertised relays do
 * not veto the responding relays. Work is bounded by metadata, independent of
 * the account's message history. */
export async function resolveMessagingMetadata(
  accountPubkey: string,
  options: { signAuth: SignAuth; abort?: AbortSignal },
): Promise<MessagingMetadata> {
  const checkAborted = () => {
    if (options.abort?.aborted) throw new Error('Messaging preparation was cancelled.');
  };
  const [cached, localDmRelays] = await Promise.all([
    getReplaceableEvents(METADATA_KINDS.map((kind) => ({ pubkey: accountPubkey, kind }))),
    loadAccountDmRelays(accountPubkey),
  ]);
  checkAborted();
  const latest = new Map<number, Event>();
  for (const event of cached) if (event) latest.set(event.kind, event);
  // Keep relay evidence separate from the cache. Otherwise a locally cached
  // declaration makes an empty relay response look populated and a publication
  // lost before reaching the relays can never repair itself.
  const relayLatest = new Map<number, Event>();
  const targets = new Set([...DISCOVERY_RELAYS, ...localDmRelays].map(normalizeRelayUrl));
  const addAdvertisedRelays = () => {
    const outbox = latest.get(KIND_RELAY_LIST_METADATA);
    for (const url of outbox ? parseRelayListMetadata(outbox).write : []) targets.add(url);
    const inbox = latest.get(KIND_DM_RELAY_LIST);
    for (const tag of inbox?.tags ?? []) {
      if (tag[0] !== 'relay' || !tag[1]) continue;
      try { targets.add(normalizeRelayUrl(tag[1])); } catch { /* Ignore malformed URLs. */ }
    }
  };
  addAdvertisedRelays();
  const queried = new Set<string>();
  const relayResults: QueryRelayResult[] = [];
  for (let round = 0; round < MAX_DISCOVERY_ROUNDS; round++) {
    const relays = [...targets].filter((url) => !queried.has(url));
    if (relays.length === 0) break;
    const events = await relayPool.query({
      label: 'dm.prepare',
      relays,
      // Separate limits so a relay cannot satisfy one kind at another's expense.
      filters: METADATA_KINDS.map((kind) => ({ kinds: [kind], authors: [accountPubkey], limit: 1 })),
      signAuth: options.signAuth,
      abort: options.abort,
      onComplete: (result) => { relayResults.push(...result.relays); },
    }).catch((error: unknown) => {
      checkAborted();
      if (!(error instanceof RelayQueryError)) throw error;
      return [] as Event[];
    });
    checkAborted();
    for (const event of events) {
      if (event.pubkey !== accountPubkey || !METADATA_KINDS.includes(event.kind)) continue;
      if (isNewerAnnouncement(event, relayLatest.get(event.kind) ?? null)) {
        relayLatest.set(event.kind, event);
      }
      if (isNewerAnnouncement(event, latest.get(event.kind) ?? null)) latest.set(event.kind, event);
    }
    for (const url of relays) queried.add(url);
    addAdvertisedRelays();
  }
  if ([...targets].some((url) => !queried.has(url))) {
    throw new Error('Messaging relay discovery did not settle.');
  }
  if (!relayResults.some((relay) => relay.status === 'eose')) {
    throw new MessagingMetadataUnavailableError(relayResults);
  }
  const announcement = latest.get(KIND_ENCRYPTION_KEY_ANNOUNCEMENT) ?? null;
  const pubkey = announcement && getEncryptionPubkeyFromEvent(announcement);
  if (announcement && (!pubkey || !/^[0-9a-f]{64}$/i.test(pubkey))) {
    throw new Error('The messaging encryption key announcement is invalid.');
  }
  checkAborted();
  for (const event of latest.values()) {
    checkAborted();
    await storeReplaceableEvent(event);
  }
  const inbox = latest.get(KIND_DM_RELAY_LIST);
  if (inbox) {
    checkAborted();
    await applyOwnDmRelayListEvent(accountPubkey, inbox);
  }
  checkAborted();
  const dmRelays = await loadAccountDmRelays(accountPubkey);
  checkAborted();

  // A completed lookup that does not contain a locally known messaging
  // declaration is evidence that the last publication may not have reached the
  // current relay set. Requeue the exact signed snapshot: replaceable ordering
  // makes the repair idempotent and avoids manufacturing a needless newer
  // version. NIP-65 is deliberately excluded: an absent remote 10002 may be an
  // intentional withdrawal, so startup must not restore it automatically.
  for (const local of cached) {
    if (
      !local ||
      (local.kind !== KIND_ENCRYPTION_KEY_ANNOUNCEMENT && local.kind !== KIND_DM_RELAY_LIST)
    ) continue;
    const remote = relayLatest.get(local.kind) ?? null;
    if (!remote || isNewerAnnouncement(local, remote)) {
      await enqueueConfigurationEvent(local);
      checkAborted();
    }
  }

  // Older installations or interrupted setup may have the durable local value
  // without an accompanying signed snapshot. Create only the declarations that
  // can be reconstructed without guessing: the current encryption key and DM
  // inbox list. NIP-65 is never repaired automatically.
  let currentKey: Awaited<ReturnType<typeof loadEncryptionKeys>>[number] | undefined;
  if (
    !latest.has(KIND_ENCRYPTION_KEY_ANNOUNCEMENT) ||
    !latest.has(KIND_DM_RELAY_LIST)
  ) {
    [currentKey] = await loadEncryptionKeys(accountPubkey);
    checkAborted();
  }
  if (!latest.has(KIND_ENCRYPTION_KEY_ANNOUNCEMENT)) {
    if (currentKey) {
      const event = await signMissingConfiguration(
        accountPubkey,
        KIND_ENCRYPTION_KEY_ANNOUNCEMENT,
        [['n', currentKey.pubkey]],
        options.signAuth,
      );
      latest.set(KIND_ENCRYPTION_KEY_ANNOUNCEMENT, event);
      checkAborted();
    }
  }
  // A keyless imported identity may still be waiting to learn whether another
  // device owns the account's current key. Its normal bootstrap path publishes
  // the inbox after creating or receiving that key, avoiding two successive
  // 10050 snapshots during first-time setup.
  if (!latest.has(KIND_DM_RELAY_LIST) && currentKey) {
    const event = await signMissingConfiguration(
      accountPubkey,
      KIND_DM_RELAY_LIST,
      dmRelays.map((url) => ['relay', url]),
      options.signAuth,
    );
    latest.set(KIND_DM_RELAY_LIST, event);
    checkAborted();
  }

  const repairedAnnouncement = latest.get(KIND_ENCRYPTION_KEY_ANNOUNCEMENT) ?? null;
  return {
    accountPubkey,
    dmRelays,
    announcementRelays: [...targets],
    announcement: repairedAnnouncement,
  };
}
