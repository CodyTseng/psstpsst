import { nip19, type Event } from 'nostr-tools';
import { publicUrl } from '@/services/napplet/protocol';

export const LIST_KINDS: Record<string, number> = {
  loadFollowsList: 3, loadMuteList: 10000, loadPins: 10001, loadRelayList: 10002,
  loadBookmarks: 10003, loadBlockedRelays: 10006, loadSearchRelays: 10007,
  loadProfileBadges: 10008, loadSimpleGroups: 10009, loadFavoriteRelays: 10012,
  loadGitAuthors: 10017, loadGitRepositories: 10018, loadMediaFollows: 10020,
  loadFavoriteFollowSets: 10021, loadFavoriteScrolls: 10027, loadEmojis: 10030,
  loadDmRelays: 10050, loadFavoritePodcasts: 10054, loadBlossomServers: 10063,
  loadAuthoredPodcasts: 10064, loadWikiAuthors: 10101, loadWikiRelays: 10102,
};
export const SET_KINDS: Record<string, number> = { loadFollowSets: 30000, loadRelaySets: 30002, loadEmojiSets: 30030 };
export const isPublicKey = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
export function normalizePublicKey(value: unknown): string {
  if (typeof value !== 'string') throw new Error('invalid-pubkey');
  if (/^[a-f0-9]{64}$/i.test(value)) return value.toLowerCase();
  const decoded = nip19.decode(value.replace(/^nostr:/, ''));
  if (decoded.type === 'npub') return decoded.data;
  if (decoded.type === 'nprofile') return decoded.data.pubkey;
  throw new Error('invalid-pubkey');
}
export type SetPointer = { kind: number; pubkey: string; identifier: string; relays: string[] };
function pointer(tag: string[], expected?: number): SetPointer | undefined {
  const [kind, pubkey, ...identifier] = (tag[1] ?? '').split(':');
  if (!isPublicKey(pubkey) || !Number.isInteger(Number(kind)) || Number(kind) < 0 || Number(kind) > 65535 || expected !== undefined && Number(kind) !== expected) return;
  return { kind: Number(kind), pubkey, identifier: identifier.join(':'), relays: tag[2] ? [publicUrl(tag[2], true)] : [] };
}
/** Parse only public tags. Encrypted list content is never read or decrypted. */
export function listItems(kind: number, event: Event | null): any[] {
  return (event?.tags ?? []).flatMap<any>(tag => {
    const [name, value, hint] = tag;
    if (!value) return [];
    try {
      if ([3, 10017, 10020, 10064, 10101, 30000].includes(kind)) return name === 'p' && isPublicKey(value) ? [value] : [];
      if ([10006, 10007, 10050, 10102, 30002].includes(kind)) return name === 'relay' ? [publicUrl(value, true)] : [];
      if (kind === 10002 && name === 'r' && (!hint || hint === 'read' || hint === 'write'))
        return [{ url: publicUrl(value, true), read: hint !== 'write', write: hint !== 'read' }];
      if (kind === 10063) return name === 'server' ? [publicUrl(value)] : [];
      if (kind === 10000) {
        const label = ({p: 'pubkey', e: 'thread', t: 'hashtag', word: 'word'} as Record<string, string>)[name];
        return label && (!['p', 'e'].includes(name) || isPublicKey(value)) ? [{ label, value }] : [];
      }
      if (kind === 10001) return name === 'e' ? [value] : [];
      if (kind === 10003) return ['e', 'a'].includes(name) ? [value] : [];
      if (kind === 10018) return name === 'a' ? [value] : [];
      if (kind === 10054) return name === 'url' || name === 'p' && isPublicKey(value) ? [value] : [];
      if (kind === 10009) return name === 'group' && hint ? [{ groupId: value, relay: publicUrl(hint, true), name: tag[3] || undefined }] : [];
      if (kind === 10027) return name === 'e' && isPublicKey(value) ? [{ id: value, kind: 1227,
        relays: hint ? [publicUrl(hint, true)] : undefined, author: isPublicKey(tag[3]) ? tag[3] : undefined }] : [];
      if ([10030, 30030].includes(kind) && name === 'emoji' && hint) return [{ shortcode: value, url: hint }];
      if (kind === 10008 && name === 'e' && isPublicKey(value)) return [value];
      if (kind === 10012 && name === 'relay') return [publicUrl(value, true)];
      if ([10008, 10012, 10021, 10030].includes(kind) && name === 'a') {
        const result = pointer(tag, ({10012: 30002, 10021: 30000, 10030: 30030} as Record<number, number>)[kind]);
        return result ? [result] : [];
      }
    } catch { /* Ignore malformed individual public tags. */ }
    return [];
  });
}
export function resolvedSet(pointer: SetPointer, event: Event | null) {
  return { pointer, event, items: listItems(pointer.kind, event), title: event?.tags.find(tag => tag[0] === 'title')?.[1] ?? pointer.identifier,
    image: event?.tags.find(tag => tag[0] === 'image')?.[1], description: event?.tags.find(tag => tag[0] === 'description')?.[1] };
}
