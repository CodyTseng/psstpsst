import { normalizeRelayUrl } from '@/lib/nostr/relay-url';
import { getDevicePreference, setDevicePreference } from '@/services/preferences/device-preferences.service';
import { APPLICATION_DISCOVERY_SOURCES } from './catalogue-relays';

export type DiscoveryFormat = 'napp' | 'napplet';
const pendingWrites = new Map<DiscoveryFormat, Promise<void>>();
const preferenceKey = (format: DiscoveryFormat) => `explore.discoveryRelays.${format}`;
export const DEFAULT_DISCOVERY_RELAYS = {
  napp: APPLICATION_DISCOVERY_SOURCES[0].relays,
  napplet: APPLICATION_DISCOVERY_SOURCES[1].relays,
};

/** Device-local directory choices never modify account messaging relays. */
export async function loadDiscoveryRelays(): Promise<Record<DiscoveryFormat, string[]>> {
  await Promise.all([...pendingWrites.values()].map(write => write.catch(() => {})));
  const [napp, napplet] = await Promise.all((['napp', 'napplet'] as const).map(async format => {
    const value = await getDevicePreference(preferenceKey(format));
    return value === null ? [...DEFAULT_DISCOVERY_RELAYS[format]] : validate(JSON.parse(value));
  }));
  return { napp, napplet };
}

function validate(relays: string[]): string[] {
  if (!Array.isArray(relays) || relays.some(url => typeof url !== 'string')) throw new Error('invalid-discovery-relays');
  return [...new Set(relays.map(normalizeRelayUrl))];
}

export async function saveDiscoveryRelays(format: DiscoveryFormat, relays: string[]): Promise<void> {
  const normalized = validate(relays);
  // Serialize rapid edits per format so a slower write cannot restore old choices.
  const previous = pendingWrites.get(format) ?? Promise.resolve();
  const write = previous.catch(() => {}).then(() => setDevicePreference(preferenceKey(format), JSON.stringify(normalized)));
  pendingWrites.set(format, write);
  try { await write; }
  finally { if (pendingWrites.get(format) === write) pendingWrites.delete(format); }
}
