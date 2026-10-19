import { publicUrl } from '@/services/napplet/protocol';
import type { NappData } from './data';
import type { Event } from 'nostr-tools';

export async function relayHealth(data: NappData, input: unknown) {
  if (!Array.isArray(input) || input.length > 200 || input.some(value => typeof value !== 'string')) throw new Error('invalid-relays');
  const urls = [...new Set(input.map(value => publicUrl(value.includes('://') ? value : `wss://${value}`, true)))];
  const results = new Map<string, unknown>();
  for (let offset = 0; offset < urls.length; offset += 25) {
    const batch = urls.slice(offset, offset + 25);
    const values = await data.memo(`health:${batch.join('|')}`, async () => {
      const now = Math.floor(Date.now() / 1000);
      const events = (await data.query(['wss://relay.nostr.watch/', 'wss://relaypag.es/'],
        [{ kinds: [30166], '#d': batch, since: now - 7 * 86400, until: now, limit: 500 }], 6000)).events;
      const groups = new Map<string, Event[]>();
      for (const event of events) {
        const value = event.tags.find(tag => tag[0] === 'd')?.[1];
        if (!value) continue;
        try { const key = publicUrl(value, true), group = groups.get(key) ?? []; group.push(event); groups.set(key, group); } catch { /* Ignore malformed monitor targets. */ }
      }
      return batch.map(url => {
        const checks = (groups.get(url) ?? []).sort((a, b) => b.created_at - a.created_at || a.id.localeCompare(b.id));
        const fresh = checks.filter(event => event.created_at >= now - 7200);
        const rtts = (fresh.length ? fresh : checks.slice(0, 1)).map(event => Number(event.tags.find(tag => tag[0] === 'rtt-open')?.[1])).filter(value => value > 0 && Number.isFinite(value)).sort((a, b) => a - b);
        const withNips = checks.find(event => event.tags.some(tag => tag[0] === 'N'));
        const withRequirements = checks.find(event => event.tags.some(tag => tag[0] === 'R'));
        return { url, status: fresh.length ? 'online' : checks.length ? 'offline' : 'unknown', checkedAt: checks[0]?.created_at ?? null,
          rtt: rtts.length ? Math.round(rtts[Math.floor(rtts.length / 2)]) : null,
          nips: withNips ? [...new Set(withNips.tags.filter(tag => tag[0] === 'N').map(tag => Number(tag[1])).filter(Number.isInteger))] : null,
          requires: withRequirements ? withRequirements.tags.filter(tag => tag[0] === 'R' && tag[1] && !tag[1].startsWith('!')).map(tag => tag[1]) : null };
      });
    }, 300000);
    for (const value of values) results.set(value.url, value);
  }
  return urls.map(url => results.get(url));
}
