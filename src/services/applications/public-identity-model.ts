import { nip19, type Event } from 'nostr-tools';

export const isPublicKey = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
export function normalizePublicKey(value: unknown): string {
  if (typeof value !== 'string') throw new Error('invalid-pubkey');
  if (/^[a-f0-9]{64}$/i.test(value)) return value.toLowerCase();
  const decoded = nip19.decode(value.replace(/^nostr:/i, ''));
  if (decoded.type === 'npub') return decoded.data;
  if (decoded.type === 'nprofile') return decoded.data.pubkey;
  throw new Error('invalid-pubkey');
}
export function newerPublicEvent(a: Event | null | undefined, b: Event | null | undefined): Event | null {
  if (!a) return b ?? null;
  if (!b) return a;
  return a.created_at > b.created_at || a.created_at === b.created_at && a.id < b.id ? a : b;
}
export function profileMetadata(event: Event | null): Record<string, unknown> {
  try {
    const value = JSON.parse(event?.content ?? '{}');
    if (value && typeof value === 'object' && !Array.isArray(value)) return value;
  } catch { /* Malformed metadata still identifies a public author. */ }
  return {};
}
export async function followedPubkeys(event: Event | null | undefined, current: () => void): Promise<string[]> {
  const result = new Set<string>(), tags = event?.tags ?? [];
  for (let i = 0; i < tags.length; i++) {
    if (i && i % 1024 === 0) { await new Promise<void>(resolve => setTimeout(resolve, 0)); current(); }
    const tag = tags[i];
    if (tag[0] === 'p' && /^[a-f0-9]{64}$/i.test(tag[1])) result.add(tag[1].toLowerCase());
  }
  return [...result];
}
