import type { Event, EventTemplate } from 'nostr-tools';

/** NIP-01 structure only; relay resource policies are not event validity rules. */
export function isEventTemplate(value: unknown): value is EventTemplate {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const event = value as Record<string, unknown>;
  return typeof event.kind === 'number' && Number.isInteger(event.kind) && event.kind >= 0 && event.kind <= 65535
    && Number.isSafeInteger(event.created_at) && typeof event.content === 'string'
    && Array.isArray(event.tags) && event.tags.every(tag => Array.isArray(tag) && tag.length > 0
      && tag.every((field: unknown) => typeof field === 'string'));
}

/** Structural validation is separate from cryptographic signature verification. */
export function isSignedEvent(value: unknown): value is Event {
  if (!isEventTemplate(value)) return false;
  const event = value as Event;
  return typeof event.pubkey === 'string' && /^[a-f0-9]{64}$/.test(event.pubkey)
    && typeof event.id === 'string' && /^[a-f0-9]{64}$/.test(event.id)
    && typeof event.sig === 'string' && /^[a-f0-9]{128}$/.test(event.sig);
}
