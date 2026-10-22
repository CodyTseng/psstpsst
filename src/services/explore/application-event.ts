import type { Event } from 'nostr-tools';
import { parseManifest } from '@/services/napplet/protocol';
import { fromNapplet, parseSite, type ExploreEntry } from './model';

export function withApplicationMetadata(entry: ExploreEntry, metadata: ExploreEntry): ExploreEntry {
  const servers = metadata.servers.length ? metadata.servers : entry.servers;
  const eventRelays = metadata.eventRelays ?? (entry.manifest?.id === metadata.manifest?.id ? entry.eventRelays : undefined);
  return { ...metadata, eventRelays, address: entry.key === metadata.key ? entry.address : metadata.address, servers, release: metadata.release ? { ...metadata.release, servers, eventRelays } : undefined,
    desktopPosition: entry.desktopPosition, lastUsedAt: entry.lastUsedAt };
}

const parsed = new Map<string, ExploreEntry>();
let bytes = 0;
const eventKey = (event: Event) => JSON.stringify([event?.id, event?.pubkey, event?.sig, event?.kind, event?.created_at, event?.content, event?.tags]);

/** Domain verification is reused across database reads, discovery and launch resolution. */
function parseEvent(event: Event, raw: string): ExploreEntry {
  const cached = parsed.get(raw);
  if (cached) return cached;
  const app = [5129, 15129, 35129].includes(event.kind) ? fromNapplet(parseManifest(event)) : parseSite(event);
  while (parsed.size >= 1024 || bytes + raw.length > 16 * 1024 * 1024) {
    const oldest = parsed.keys().next().value;
    if (!oldest) break;
    bytes -= oldest.length; parsed.delete(oldest);
  }
  parsed.set(raw, app); bytes += raw.length;
  return app;
}


export function parseApplicationEvent(event: Event): ExploreEntry { return parseEvent(event, eventKey(event)); }

/** Only new signature work yields; warm list reads reuse settled verification results. */
export async function parseApplicationEvents(events: readonly Event[]): Promise<(ExploreEntry | undefined)[]> {
  const result: (ExploreEntry | undefined)[] = [];
  let cold = 0;
  for (const event of events) {
    const raw = eventKey(event);
    if (!parsed.has(raw) && ++cold % 4 === 0) await new Promise<void>(resolve => setTimeout(resolve, 0));
    try { result.push(parseEvent(event, raw)); } catch { result.push(undefined); }
  }
  return result;
}
