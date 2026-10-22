import type { Event } from 'nostr-tools';
import type { ReplaceableKey } from '@/services/relay/replaceable-events.service';
const versions = new Map<string, Event>();
const immutable = new Map<string, Event>();
const keyOf = (key: ReplaceableKey) => JSON.stringify([key.pubkey, key.kind, key.dTag ?? '']);
export function clearApplicationTestCache() { versions.clear(); immutable.clear(); }
export const replaceableCache = {
  getReplaceableEvent: jest.fn(async (key: ReplaceableKey) => versions.get(keyOf(key)) ?? null),
  getReplaceableEvents: jest.fn(async (keys: ReplaceableKey[]) => keys.map(key => versions.get(keyOf(key)) ?? null)),
  getReplaceableEventRecords: jest.fn(async (keys: ReplaceableKey[]) => keys.map(key => ({ event: versions.get(keyOf(key)) ?? null, relays: [] }))),
  storeReplaceableEvent: jest.fn(async (event: Event) => { versions.set(keyOf({ pubkey: event.pubkey, kind: event.kind,
    dTag: event.kind >= 30000 ? event.tags.find(tag => tag[0] === 'd')?.[1] ?? '' : '' }), event); return true; }),
  ensureReplaceableFresh: jest.fn(async () => {}),
};
export const immutableCache = {
  readCachedEventRecords: jest.fn(async (ids: string[]) => new Map(ids.flatMap(id => immutable.has(id) ? [[id, { event: immutable.get(id)!, relays: [] }]] : []))),
  readCachedEvents: jest.fn(async (ids: string[]) => new Map(ids.flatMap(id => immutable.has(id) ? [[id, immutable.get(id)!]] : []))),
  storeCachedEvent: jest.fn(async (event: Event) => { immutable.set(event.id, event); }),
};
