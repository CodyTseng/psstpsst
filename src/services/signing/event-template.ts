import type { EventTemplate } from 'nostr-tools';

/** Copy only unsigned fields before presenting and signing an application request. */
export function signingTemplate(input: any): EventTemplate {
  if (!input || !Number.isInteger(input.kind) || input.kind < 0 || input.kind > 65535 ||
      typeof input.content !== 'string' || input.content.length > 64000 ||
      !Number.isSafeInteger(input.created_at) || input.created_at < 0 ||
      input.created_at > Math.floor(Date.now() / 1000) + 86400 ||
      !Array.isArray(input.tags) || input.tags.length > 128 ||
      input.tags.some((tag: unknown) => !Array.isArray(tag) || tag.length > 16 ||
        tag.some((value: unknown) => typeof value !== 'string' || value.length > 4096)))
    throw new Error('invalid-event');
  const event: EventTemplate = { kind: input.kind, content: input.content,
    created_at: input.created_at, tags: input.tags.map((tag: string[]) => [...tag]) };
  if (event.kind === 22242 && (event.content !== '' ||
      event.tags.filter(tag => tag[0] === 'relay').length !== 1 ||
      event.tags.filter(tag => tag[0] === 'challenge').length !== 1 ||
      !/^wss?:\/\//.test(event.tags.find(tag => tag[0] === 'relay')?.[1] ?? '') ||
      !event.tags.find(tag => tag[0] === 'challenge')?.[1]))
    throw new Error('invalid-auth');
  return event;
}
