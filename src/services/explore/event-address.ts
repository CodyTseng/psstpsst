import { decode } from 'nostr-tools/nip19';
import type { Filter } from 'nostr-tools';
import { publicUrl } from '@/services/napplet/protocol';

/** Event pointers are broader than the application-manifest address grammar. */
export function publicEventAddress(value: unknown): { filters: Filter[]; relays: string[]; author?: string } {
  let pointer: any = value;
  if (pointer && typeof pointer === 'object' && !pointer.type) {
    if (typeof pointer.id === 'string') pointer = { type: 'nevent', data: pointer };
    else if (typeof pointer.identifier === 'string') pointer = { type: 'naddr', data: pointer };
  }
  if (typeof value === 'string') {
    const code = value.trim().replace(/^nostr:/, '');
    if (/^[a-f0-9]{64}$/.test(code)) return { filters: [{ ids: [code], limit: 1 }], relays: [] };
    pointer = decode(code);
  }
  const hex = (input: unknown): input is string => typeof input === 'string' && /^[a-f0-9]{64}$/.test(input);
  if (pointer?.type === 'note' && hex(pointer.data)) return { filters: [{ ids: [pointer.data], limit: 1 }], relays: [] };
  const data = pointer?.data;
  if (!data || !Array.isArray(data.relays ?? [])) throw new Error('invalid-event-address');
  const relays = (data.relays ?? []).map((url: unknown) => {
    if (typeof url !== 'string') throw new Error('invalid-event-address');
    return publicUrl(url, true);
  });
  if (pointer.type === 'nevent' && hex(data.id) && (data.author === undefined || hex(data.author)))
    return { filters: [{ ids: [data.id], limit: 1 }], relays, author: data.author };
  if (pointer.type === 'naddr' && hex(data.pubkey) && Number.isInteger(data.kind) && data.kind >= 0 && data.kind <= 65535 &&
    typeof data.identifier === 'string')
    return { filters: [{ authors: [data.pubkey], kinds: [data.kind], ...(data.kind >= 30000 && data.kind < 40000 ? { '#d': [data.identifier] } : {}), limit: 1 }], relays, author: data.pubkey };
  throw new Error('invalid-event-address');
}
