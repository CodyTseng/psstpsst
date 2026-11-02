import { DISCOVERY_RELAYS } from '@/lib/nostr/relay-url';
import { publicUrl } from '@/services/napplet/protocol';

export function relayUrls(values: unknown, fallback = DISCOVERY_RELAYS): string[] {
  const urls = values == null ? fallback : values;
  if (!Array.isArray(urls) || urls.some((v) => typeof v !== 'string'))
    throw new Error('invalid-relays');
  return [...new Set(urls.map((v) => publicUrl(v, true)))];
}
