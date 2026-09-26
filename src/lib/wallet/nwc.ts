import { nip47 } from 'nostr-tools';

import { normalizeRelayUrl } from '@/lib/nostr/relay-url';

export function parseNwcConnectionString(
  connectionString: string,
): ReturnType<typeof nip47.parseConnectionString> {
  const trimmed = connectionString.trim();
  if (!/^nostr\+walletconnect:\/\//i.test(trimmed)) {
    throw new Error('Invalid NWC connection scheme');
  }
  const parsed = nip47.parseConnectionString(trimmed);
  for (const relay of parsed.relays) normalizeRelayUrl(relay);
  return parsed;
}
