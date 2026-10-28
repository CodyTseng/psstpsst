import type { Event } from 'nostr-tools';
import { decode, naddrEncode, neventEncode } from 'nostr-tools/nip19';

type EventIdentity = Pick<Event, 'id' | 'kind' | 'pubkey' | 'tags'>;

/** Stable identity across versions; an event ID still identifies one exact version. */
export function eventCoordinate(event: Pick<EventIdentity, 'kind' | 'pubkey' | 'tags'>): string | null {
  const { kind, pubkey } = event;
  if (kind >= 30000 && kind < 40000) return `${kind}:${pubkey}:${event.tags.find(tag => tag[0] === 'd')?.[1] ?? ''}`;
  if (kind === 0 || kind === 3 || kind >= 10000 && kind < 20000) return `${kind}:${pubkey}:`;
  return null;
}

export function eventKey(event: EventIdentity): string {
  return eventCoordinate(event) ?? event.id;
}

/** Decode transport references at the boundary; unresolved event pointers retain their ID. */
export function normalizeEventKey(value: string): string {
  const input = value.trim().replace(/^nostr:/i, '');
  if (/^[a-f0-9]{64}$/.test(input)) return input;
  if (/^5129:[a-f0-9]{64}$/.test(input)) return input.slice(5);
  if (/^(naddr|nevent|note)1/i.test(input)) {
    const decoded = decode(input);
    if (decoded.type === 'nevent') return decoded.data.id;
    if (decoded.type === 'note') return decoded.data;
    if (decoded.type === 'naddr') return normalizeEventKey(`${decoded.data.kind}:${decoded.data.pubkey}:${decoded.data.identifier}`);
  }
  const match = /^(0|3|[1-9][0-9]*):([a-f0-9]{64}):(.*)$/s.exec(input);
  if (match) {
    const kind = Number(match[1]);
    if (kind >= 30000 && kind < 40000 || (kind === 0 || kind === 3 || kind >= 10000 && kind < 20000) && !match[3]) return input;
  }
  throw new Error('invalid-event-key');
}

/** Encode transport references and compatible platform storage names. */
export function eventKeyAddress(value: string): string {
  const key = normalizeEventKey(value);
  if (/^[a-f0-9]{64}$/.test(key)) return neventEncode({ id: key });
  const [kind, pubkey, ...identifier] = key.split(':');
  return naddrEncode({ kind: Number(kind), pubkey, identifier: identifier.join(':') });
}
