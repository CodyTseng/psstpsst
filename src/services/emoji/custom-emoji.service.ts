import { and, desc, eq } from 'drizzle-orm';
import { generateSecretKey } from 'nostr-tools';
import { nip19, type Event } from 'nostr-tools';

import { db } from '@/db/client';
import { replaceableEvents } from '@/db/schema';
import { bytesToHex } from '@/lib/nostr/keys';
import {
  buildEmojiTag,
  KIND_EMOJI_SET,
  KIND_USER_EMOJI_LIST,
  MAX_EMOJIS_PER_PACK,
  MAX_EMOJI_PACK_TITLE_LENGTH,
  isValidEmojiShortcode,
  isValidEmojiUrl,
  normalizeEmojiShortcode,
  parseEmojiTag,
  parseEmojiSetCoordinate,
  parseEmojiSetEvent,
  parseUserEmojiListEvent,
  type CustomEmoji,
  type EmojiPack,
} from '@/lib/nostr/custom-emoji';
import { buildSigner } from '@/services/account/account.service';
import { enqueueConfigurationEvent, publishConfiguration } from '@/services/relay/configuration-publish.service';
import { relayPool } from '@/services/relay/relay-pool';
import { peerMetaRelays } from '@/services/relay/relay-router';
import {
  ensureReplaceableFresh,
  getReplaceableEvent,
  getReplaceableEvents,
  REPLACEABLE_DEFAULT_TTL_SECONDS,
  storeReplaceableEvent,
  type ReplaceableKey,
} from '@/services/relay/replaceable-events.service';

const QUERY_TIMEOUT_MS = 10_000;
const AUTHOR_PACK_LIMIT = 500;
const AUTHOR_PACK_QUERY_LIMIT = 500;

export type EmojiCollection = {
  standalone: CustomEmoji[];
  packs: EmojiPack[];
  loaded: boolean;
  version: number;
};

const EMPTY_COLLECTION: EmojiCollection = {
  standalone: [],
  packs: [],
  loaded: false,
  version: 0,
};

const collections = new Map<string, EmojiCollection>();
const listeners = new Map<string, Set<() => void>>();
const loadInflight = new Map<string, Promise<EmojiCollection>>();
const mutationQueues = new Map<string, Promise<void>>();
const mutationRevisions = new Map<string, number>();

function emit(accountPubkey: string, next: Omit<EmojiCollection, 'version'>): EmojiCollection {
  const value = { ...next, version: (collections.get(accountPubkey)?.version ?? 0) + 1 };
  collections.set(accountPubkey, value);
  listeners.get(accountPubkey)?.forEach((listener) => listener());
  return value;
}

function updateCollection(
  accountPubkey: string,
  transform: (current: EmojiCollection) => Omit<EmojiCollection, 'version'> | null,
): number {
  const current = getEmojiCollectionSnapshot(accountPubkey);
  const next = transform(current);
  if (next) emit(accountPubkey, next);
  const revision = (mutationRevisions.get(accountPubkey) ?? 0) + 1;
  mutationRevisions.set(accountPubkey, revision);
  return revision;
}

function nextMacrotask(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function standaloneDisplayOrder(emojis: CustomEmoji[]): CustomEmoji[] {
  return [...emojis].reverse();
}

function packDisplayOrder(
  coordinates: string[],
  packs: Map<string, EmojiPack>,
): EmojiPack[] {
  return [...coordinates]
    .reverse()
    .map((coordinate) => packs.get(coordinate))
    .filter((pack): pack is EmojiPack => !!pack);
}

export function subscribeEmojiCollection(accountPubkey: string, listener: () => void): () => void {
  const set = listeners.get(accountPubkey) ?? new Set();
  set.add(listener);
  listeners.set(accountPubkey, set);
  return () => {
    set.delete(listener);
    if (set.size === 0) listeners.delete(accountPubkey);
  };
}

export function getEmojiCollectionSnapshot(accountPubkey: string): EmojiCollection {
  return collections.get(accountPubkey) ?? EMPTY_COLLECTION;
}

async function latestLocalUserList(accountPubkey: string): Promise<Event | null> {
  return getReplaceableEvent({ pubkey: accountPubkey, kind: KIND_USER_EMOJI_LIST });
}

async function localPacks(coordinates: string[]): Promise<Map<string, EmojiPack>> {
  const entries = coordinates.map((coordinate) => {
    const parsed = parseEmojiSetCoordinate(coordinate);
    return parsed
      ? {
          coordinate,
          key: {
            pubkey: parsed.authorPubkey,
            kind: KIND_EMOJI_SET,
            dTag: parsed.identifier,
          } satisfies ReplaceableKey,
        }
      : null;
  });
  const valid = entries.filter((entry): entry is NonNullable<typeof entry> => entry !== null);
  const events = await getReplaceableEvents(valid.map((entry) => entry.key));
  const result = new Map<string, EmojiPack>();
  valid.forEach((entry, index) => {
    const event = events[index];
    if (!event) return;
    const pack = parseEmojiSetEvent(event);
    if (pack) result.set(entry.coordinate, pack);
  });
  return result;
}

/**
 * Resolve packs by coordinate, cache-first: rows confirmed within the TTL are
 * used as-is; stale or missing ones are refreshed from each author's meta
 * relays (keys sharing a relay set go out as one multi-filter REQ) and
 * persisted. Returns packs in the input order, dropping ones no relay has.
 */
async function fetchPacksByCoordinates(coordinates: string[]): Promise<EmojiPack[]> {
  const keys: ReplaceableKey[] = [];
  for (const coordinate of coordinates) {
    const parsed = parseEmojiSetCoordinate(coordinate);
    if (!parsed) continue;
    keys.push({ pubkey: parsed.authorPubkey, kind: KIND_EMOJI_SET, dTag: parsed.identifier });
  }
  await ensureReplaceableFresh(keys, {
    ttlSeconds: REPLACEABLE_DEFAULT_TTL_SECONDS,
    relays: (key) => peerMetaRelays(key.pubkey),
  });
  const stored = await localPacks(coordinates);
  return coordinates.map((coordinate) => stored.get(coordinate)).filter((p): p is EmojiPack => !!p);
}

export async function loadEmojiCollection(accountPubkey: string): Promise<EmojiCollection> {
  const existing = loadInflight.get(accountPubkey);
  if (existing) return existing;
  const startingRevision = mutationRevisions.get(accountPubkey) ?? 0;
  const request = (async () => {
    const listEvent = await latestLocalUserList(accountPubkey);
    const list = parseUserEmojiListEvent(listEvent);
    const cached = await localPacks(list.packCoordinates);
    const missing = list.packCoordinates.filter((coordinate) => !cached.has(coordinate));
    if (
      (mutationRevisions.get(accountPubkey) ?? 0) !== startingRevision ||
      mutationQueues.has(accountPubkey)
    ) {
      return getEmojiCollectionSnapshot(accountPubkey);
    }
    const initial = emit(accountPubkey, {
      standalone: standaloneDisplayOrder(list.standalone),
      packs: packDisplayOrder(list.packCoordinates, cached),
      loaded: missing.length === 0,
    });
    return initial;
  })().finally(() => loadInflight.delete(accountPubkey));
  loadInflight.set(accountPubkey, request);
  return request;
}

export async function refreshEmojiCollection(accountPubkey: string): Promise<EmojiCollection> {
  const listEvent = await latestLocalUserList(accountPubkey);
  const list = parseUserEmojiListEvent(listEvent);
  const packs = await localPacks(list.packCoordinates);
  return emit(accountPubkey, {
    standalone: standaloneDisplayOrder(list.standalone),
    packs: packDisplayOrder(list.packCoordinates, packs),
    loaded: true,
  });
}

/**
 * Reconcile the emoji collection from the account's kind-10030 list event as
 * read from the replaceable-events cache (`syncPersonalConfigs` owns freshness
 * and storage): load the referenced packs (cache-first) and re-emit. A
 * reconcile landing while a local mutation is queued never clobbers the
 * optimistic collection — the same revision guard the old relay-pull sync used.
 */
export async function applyUserEmojiListEvent(
  accountPubkey: string,
  event: Event | null,
): Promise<void> {
  const startingRevision = mutationRevisions.get(accountPubkey) ?? 0;
  const list = parseUserEmojiListEvent(event ?? (await latestLocalUserList(accountPubkey)));
  if (list.packCoordinates.length > 0) await fetchPacksByCoordinates(list.packCoordinates);
  if (
    (mutationRevisions.get(accountPubkey) ?? 0) === startingRevision &&
    !mutationQueues.has(accountPubkey)
  ) {
    await refreshEmojiCollection(accountPubkey);
  }
}

async function persistUserListMutation(
  accountPubkey: string,
  transform: (tags: string[][]) => string[][] | null,
): Promise<Event | null> {
  const signer = await buildSigner(accountPubkey);
  let event: Event | null = null;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const local = await latestLocalUserList(accountPubkey);
    const tags = transform(local?.tags ?? []);
    if (!tags) return null;
    const candidate = await signer.signEvent({
      kind: KIND_USER_EMOJI_LIST,
      content: local?.content ?? '',
      tags,
      created_at: Math.max(
        Math.floor(Date.now() / 1000),
        (local?.created_at ?? 0) + 1,
      ),
    });
    if (await enqueueConfigurationEvent(candidate)) {
      event = candidate;
      break;
    }
  }
  if (!event) {
    throw new Error('Could not persist the latest emoji collection.');
  }

  return event;
}

function enqueueUserListMutation(
  accountPubkey: string,
  revision: number,
  task: () => Promise<void>,
): Promise<void> {
  const previous = mutationQueues.get(accountPubkey) ?? Promise.resolve();
  const queued = previous
    .catch(() => {})
    .then(nextMacrotask)
    .then(task);
  mutationQueues.set(accountPubkey, queued);
  void queued.then(
    () => {
      if (mutationQueues.get(accountPubkey) === queued) {
        mutationQueues.delete(accountPubkey);
      }
    },
    () => {
      if (mutationQueues.get(accountPubkey) === queued) {
        mutationQueues.delete(accountPubkey);
      }
    },
  );
  return queued.catch(async (error) => {
    if (mutationRevisions.get(accountPubkey) === revision) {
      await refreshEmojiCollection(accountPubkey).catch(() => {});
    }
    throw error;
  });
}

export function addEmojiPack(accountPubkey: string, pack: EmojiPack): Promise<void> {
  const revision = updateCollection(accountPubkey, (current) => {
    if (current.packs.some((item) => item.coordinate === pack.coordinate)) return null;
    return { ...current, packs: [pack, ...current.packs] };
  });
  return enqueueUserListMutation(accountPubkey, revision, async () => {
    await storeReplaceableEvent(pack.event);
    await persistUserListMutation(accountPubkey, (tags) => {
      if (tags.some((tag) => tag[0] === 'a' && tag[1] === pack.coordinate)) return null;
      return [...tags, ['a', pack.coordinate]];
    });
  });
}

export function removeEmojiPack(accountPubkey: string, coordinate: string): Promise<void> {
  const revision = updateCollection(accountPubkey, (current) => {
    const packs = current.packs.filter((pack) => pack.coordinate !== coordinate);
    return packs.length === current.packs.length ? null : { ...current, packs };
  });
  return enqueueUserListMutation(accountPubkey, revision, async () => {
    await persistUserListMutation(accountPubkey, (tags) => {
      const next = tags.filter((tag) => tag[0] !== 'a' || tag[1] !== coordinate);
      return next.length === tags.length ? null : next;
    });
  });
}

function sameStandaloneEmoji(left: CustomEmoji, right: CustomEmoji): boolean {
  return (
    left.shortcode.toLowerCase() === right.shortcode.toLowerCase() &&
    left.url === right.url
  );
}

function matchesStandaloneEmojiTag(tag: string[], emoji: CustomEmoji): boolean {
  const parsed = parseEmojiTag(tag);
  return !!parsed && sameStandaloneEmoji(parsed, emoji);
}

export function addStandaloneEmoji(
  accountPubkey: string,
  emoji: CustomEmoji,
): Promise<void> {
  const revision = updateCollection(accountPubkey, (current) => {
    if (current.standalone.some((item) => sameStandaloneEmoji(item, emoji))) {
      return null;
    }
    return { ...current, standalone: [emoji, ...current.standalone] };
  });
  return enqueueUserListMutation(accountPubkey, revision, async () => {
    await persistUserListMutation(accountPubkey, (tags) => {
      if (tags.some((tag) => matchesStandaloneEmojiTag(tag, emoji))) return null;
      return [...tags, buildEmojiTag(emoji)];
    });
  });
}

export function removeStandaloneEmoji(
  accountPubkey: string,
  emoji: CustomEmoji,
): Promise<void> {
  const revision = updateCollection(accountPubkey, (current) => {
    const standalone = current.standalone.filter(
      (item) => !sameStandaloneEmoji(item, emoji),
    );
    return standalone.length === current.standalone.length
      ? null
      : { ...current, standalone };
  });
  return enqueueUserListMutation(accountPubkey, revision, async () => {
    await persistUserListMutation(accountPubkey, (tags) => {
      const next = tags.filter((tag) => !matchesStandaloneEmojiTag(tag, emoji));
      return next.length === tags.length ? null : next;
    });
  });
}

export function renameStandaloneEmoji(
  accountPubkey: string,
  emoji: CustomEmoji,
  value: string,
): Promise<void> {
  const shortcode = normalizeEmojiShortcode(value);
  if (!isValidEmojiShortcode(shortcode)) {
    return Promise.reject(new Error('Invalid custom emoji shortcode.'));
  }

  const current = getEmojiCollectionSnapshot(accountPubkey);
  const targetIndex = current.standalone.findIndex((item) =>
    sameStandaloneEmoji(item, emoji),
  );
  if (targetIndex < 0) return Promise.resolve();
  if (
    current.standalone.some(
      (item, index) =>
        index !== targetIndex &&
        item.shortcode.toLowerCase() === shortcode.toLowerCase(),
    )
  ) {
    return Promise.reject(new Error('That custom emoji shortcode is already in use.'));
  }
  if (current.standalone[targetIndex].shortcode === shortcode) {
    return Promise.resolve();
  }

  const renamed = { ...current.standalone[targetIndex], shortcode };
  const revision = updateCollection(accountPubkey, (collection) => ({
    ...collection,
    standalone: collection.standalone.map((item) =>
      sameStandaloneEmoji(item, emoji) ? renamed : item,
    ),
  }));
  return enqueueUserListMutation(accountPubkey, revision, async () => {
    await persistUserListMutation(accountPubkey, (tags) => {
      const collision = tags.some((tag) => {
        const parsed = parseEmojiTag(tag);
        return (
          !!parsed &&
          !matchesStandaloneEmojiTag(tag, emoji) &&
          parsed.shortcode.toLowerCase() === shortcode.toLowerCase()
        );
      });
      if (collision) {
        throw new Error('That custom emoji shortcode is already in use.');
      }

      let replaced = false;
      const next = tags.map((tag) => {
        if (replaced || !matchesStandaloneEmojiTag(tag, emoji)) return tag;
        replaced = true;
        const renamedTag = [...tag];
        renamedTag[1] = shortcode;
        return renamedTag;
      });
      return replaced ? next : null;
    });
  });
}

export function reorderStandaloneEmojis(
  accountPubkey: string,
  emojis: CustomEmoji[],
): Promise<void> {
  const revision = updateCollection(accountPubkey, (current) => ({
    ...current,
    standalone: emojis,
  }));
  return enqueueUserListMutation(accountPubkey, revision, async () => {
    await persistUserListMutation(accountPubkey, (tags) => {
      const persistedEmojis = [...emojis].reverse();
      const current = tags.filter((tag) => parseEmojiTag(tag));
      const tagsByEmoji = new Map<string, string[][]>();
      for (const tag of current) {
        const parsed = parseEmojiTag(tag);
        if (!parsed) continue;
        const key = JSON.stringify([parsed.shortcode.toLowerCase(), parsed.url]);
        const matching = tagsByEmoji.get(key);
        if (matching) matching.push(tag);
        else tagsByEmoji.set(key, [tag]);
      }

      const used = new Set<string[]>();
      const reordered: string[][] = [];
      for (const emoji of persistedEmojis) {
        const key = JSON.stringify([emoji.shortcode.toLowerCase(), emoji.url]);
        const tag = tagsByEmoji.get(key)?.shift();
        if (!tag) continue;
        used.add(tag);
        reordered.push(tag);
      }
      for (const tag of current) {
        if (!used.has(tag)) reordered.push(tag);
      }
      if (reordered.every((tag, index) => tag === current[index])) return null;

      let standaloneIndex = 0;
      return tags.map((tag) =>
        parseEmojiTag(tag) ? reordered[standaloneIndex++] : tag,
      );
    });
  });
}

export function reorderEmojiPacks(
  accountPubkey: string,
  coordinates: string[],
): Promise<void> {
  const displayOrder = new Map(
    coordinates.map((coordinate, index) => [coordinate, index]),
  );
  const revision = updateCollection(accountPubkey, (current) => ({
    ...current,
    packs: [...current.packs].sort(
      (left, right) =>
        (displayOrder.get(left.coordinate) ?? Number.MAX_SAFE_INTEGER) -
        (displayOrder.get(right.coordinate) ?? Number.MAX_SAFE_INTEGER),
    ),
  }));
  return enqueueUserListMutation(accountPubkey, revision, async () => {
    await persistUserListMutation(accountPubkey, (tags) => {
      const persistedOrder = new Map(
        [...coordinates].reverse().map((coordinate, index) => [coordinate, index]),
      );
      const packs = tags.filter((tag) => tag[0] === 'a' && parseEmojiSetCoordinate(tag[1]));
      const others = tags.filter((tag) => tag[0] !== 'a' || !parseEmojiSetCoordinate(tag[1]));
      packs.sort(
        (a, b) =>
          (persistedOrder.get(a[1]) ?? Number.MAX_SAFE_INTEGER) -
          (persistedOrder.get(b[1]) ?? Number.MAX_SAFE_INTEGER),
      );
      return [...others, ...packs];
    });
  });
}

export async function saveEmojiPack(opts: {
  accountPubkey: string;
  title: string;
  emojis: Pick<CustomEmoji, 'shortcode' | 'url'>[];
  existing?: EmojiPack;
}): Promise<EmojiPack> {
  const title = opts.title.trim().slice(0, MAX_EMOJI_PACK_TITLE_LENGTH);
  if (!title) throw new Error('A pack name is required.');
  if (opts.emojis.length === 0) throw new Error('Add at least one emoji.');
  if (opts.emojis.length > MAX_EMOJIS_PER_PACK) throw new Error('This pack has too many emojis.');
  const shortcodes = new Set<string>();
  for (const emoji of opts.emojis) {
    const key = emoji.shortcode.toLowerCase();
    if (!isValidEmojiShortcode(emoji.shortcode) || !isValidEmojiUrl(emoji.url)) {
      throw new Error('Every emoji needs a valid shortcode and image URL.');
    }
    if (shortcodes.has(key)) throw new Error('Emoji shortcodes must be unique within a pack.');
    shortcodes.add(key);
  }
  if (opts.existing && opts.existing.authorPubkey !== opts.accountPubkey) {
    throw new Error('Only the pack owner can edit it.');
  }
  const identifier =
    opts.existing?.identifier ?? bytesToHex(generateSecretKey()).slice(0, 32);
  const preservedTags =
    opts.existing?.event.tags.filter(
      (tag) => tag[0] !== 'd' && tag[0] !== 'title' && tag[0] !== 'emoji',
    ) ?? [];
  const signer = await buildSigner(opts.accountPubkey);
  const event = await publishConfiguration(opts.accountPubkey, signer, {
    kind: KIND_EMOJI_SET,
    content: opts.existing?.event.content ?? '',
    tags: [
      ['d', identifier],
      ['title', title],
      ...preservedTags,
      ...opts.emojis.map((emoji) => buildEmojiTag(emoji)),
    ],
    created_at: Math.floor(Date.now() / 1000),
  });
  const pack = parseEmojiSetEvent(event);
  if (!pack) throw new Error('The emoji pack is invalid.');
  await storeReplaceableEvent(event);
  await addEmojiPack(opts.accountPubkey, pack);
  return pack;
}

export async function getEmojiPack(
  coordinate: string,
  fetchRemote = true,
): Promise<EmojiPack | null> {
  const local = await localPacks([coordinate]);
  const cached = local.get(coordinate);
  if (cached || !fetchRemote) return cached ?? null;
  return (await fetchPacksByCoordinates([coordinate]))[0] ?? null;
}

export async function loadCachedEmojiPacksByAuthor(
  authorPubkey: string,
): Promise<EmojiPack[]> {
  const rows = await db
    .select({ event: replaceableEvents.event })
    .from(replaceableEvents)
    .where(
      and(eq(replaceableEvents.pubkey, authorPubkey), eq(replaceableEvents.kind, KIND_EMOJI_SET)),
    )
    .orderBy(desc(replaceableEvents.createdAt))
    .limit(AUTHOR_PACK_LIMIT);
  return rows
    .map((row) => (row.event ? parseEmojiSetEvent(row.event) : null))
    .filter((pack): pack is EmojiPack => pack?.authorPubkey === authorPubkey);
}

/** Resolve a bounded catalogue for one explicitly selected author. This is not
 * public discovery: the query is scoped to the author's own metadata relays.
 * Results land in the shared replaceable-events cache, which backs
 * {@link loadCachedEmojiPacksByAuthor}. */
export async function fetchEmojiPacksByAuthor(authorPubkey: string): Promise<EmojiPack[]> {
  const relays = await peerMetaRelays(authorPubkey);
  const events = await relayPool.query({
    label: 'emoji-packs-by-author',
    relays,
    filter: {
      kinds: [KIND_EMOJI_SET],
      authors: [authorPubkey],
      limit: AUTHOR_PACK_QUERY_LIMIT,
    },
    timeoutMs: QUERY_TIMEOUT_MS,
  });
  let stored = 0;
  for (const event of events) {
    const pack = parseEmojiSetEvent(event);
    if (pack?.authorPubkey !== authorPubkey) continue;
    await storeReplaceableEvent(event);
    stored += 1;
    if (stored % 25 === 0) await nextMacrotask();
  }
  return loadCachedEmojiPacksByAuthor(authorPubkey);
}

export function emojiPackShareContent(pack: EmojiPack): string {
  return `nostr:${nip19.naddrEncode({
    kind: KIND_EMOJI_SET,
    pubkey: pack.authorPubkey,
    identifier: pack.identifier,
  })}`;
}

export function emojiPackShareContentFromCoordinate(coordinate: string): string | null {
  const parsed = parseEmojiSetCoordinate(coordinate);
  if (!parsed) return null;
  return `nostr:${nip19.naddrEncode({
    kind: KIND_EMOJI_SET,
    pubkey: parsed.authorPubkey,
    identifier: parsed.identifier,
  })}`;
}
