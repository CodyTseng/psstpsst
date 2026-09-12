export function pickTagValue(tags: string[][], name: string): string | undefined {
  return tags.find((t) => t[0] === name)?.[1];
}

export function pickAllTagValues(tags: string[][], name: string): string[] {
  return tags.filter((t) => t[0] === name).map((t) => t[1]).filter(Boolean);
}

export function getPTags(tags: string[][]): string[] {
  return pickAllTagValues(tags, 'p');
}

export function getSubject(tags: string[][]): string | undefined {
  return pickTagValue(tags, 'subject');
}

/** First `e` tag in a rumor is treated as the reply target. */
export function getReplyToId(tags: string[][]): string | undefined {
  return pickTagValue(tags, 'e');
}

/** Tags that describe the original send rather than its forwarded payload. */
const NON_FORWARDABLE_TAGS = new Set(['p', 'e', 'h', 'subject', 'ms']);

/**
 * Tags to carry over when **forwarding** a message: everything that describes
 * the payload itself (file-type, decryption-key/nonce, x/ox, size, dim,
 * blurhash/thumbhash, name, duration, waveform, …) minus the routing tags
 * (`p`/`e`/`h`/`subject`) plus the original `ms` ordering stamp. The forward
 * replaces those with its own routing and fresh ordering metadata. Attachment
 * payload tags stay intact, so the recipient decrypts the same blob.
 */
export function forwardableTags(tags: string[][]): string[][] {
  return tags.filter((t) => !NON_FORWARDABLE_TAGS.has(t[0]));
}
