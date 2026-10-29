import type { EventTemplate } from 'nostr-tools';
import { isEventTemplate } from '@/lib/nostr/event-validation';

/** Copy only unsigned fields before presenting and signing an application request. */
export function signingTemplate(input: unknown, validateRelayAuth = true): EventTemplate {
  if (!isEventTemplate(input)) throw new Error('invalid-event');
  const event: EventTemplate = { kind: input.kind, content: input.content,
    created_at: input.created_at, tags: input.tags.map((tag: string[]) => [...tag]) };
  if (validateRelayAuth && event.kind === 22242 && (event.content !== '' ||
      event.tags.filter(tag => tag[0] === 'relay').length !== 1 ||
      event.tags.filter(tag => tag[0] === 'challenge').length !== 1 ||
      !/^wss?:\/\//.test(event.tags.find(tag => tag[0] === 'relay')?.[1] ?? '') ||
      !event.tags.find(tag => tag[0] === 'challenge')?.[1]))
    throw new Error('invalid-auth');
  return event;
}
