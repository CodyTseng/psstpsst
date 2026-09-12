export function normalizeRelayUrl(url: string): string {
  const u = new URL(url);
  if (u.protocol !== 'ws:' && u.protocol !== 'wss:') {
    throw new Error(`Unsupported relay protocol: ${u.protocol}`);
  }
  u.host = u.host.toLowerCase();
  return u.toString().replace(/\/$/, '');
}

export const DEFAULT_DM_RELAYS = [
  'wss://nos.lol',
  'wss://relay.primal.net',
  'wss://nip17.com',
  'wss://offchain.pub',
];

/**
 * Relays we always consult when looking up someone else's metadata
 * (kind 0 profile, kind 10050 DM relay list). The user's own DM relays
 * may not have what we need — these are widely-replicated indexes.
 */
export const DISCOVERY_RELAYS = [
  'wss://nos.lol',
  'wss://relay.primal.net',
  'wss://relay.ditto.pub',
  'wss://offchain.pub',
];
