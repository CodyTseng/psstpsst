import type { Event } from 'nostr-tools';

import { DISCOVERY_RELAYS, normalizeRelayUrl } from '@/lib/nostr/relay-url';

import {
  KIND_DM_RELAY_LIST,
  KIND_ENCRYPTION_KEY_ANNOUNCEMENT,
  KIND_RELAY_LIST_METADATA,
} from '../crypto/nip17-gift-wrap';
import { applyOwnDmRelayListEvent, loadAccountDmRelays } from '../relay/relay-list.service';
import { relayPool } from '../relay/relay-pool';
import { RelayQueryError } from '../relay/relay-query-error';
import type { QueryRelayResult, SignAuth } from '../relay/managed-relay-pool';
import { parseRelayListMetadata } from '../relay/relay-router';
import { getReplaceableEvents, storeReplaceableEvent } from '../relay/replaceable-events.service';
import { getEncryptionPubkeyFromEvent } from './encryption-key.service';

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
  return { accountPubkey, dmRelays, announcementRelays: [...targets], announcement };
}
