import { assertNotAborted } from '@/platform/abort';
import { localRelay } from '@/services/local-relay';
import type { NappData } from './data';
import { isPublicKey } from './lists';

const privateKinds = new Set([4, 13, 14, 15, 1059]);
let active = 0;
const waiters: { signal: AbortSignal; start(): void; cancel(): void }[] = [];
/** Syncs share a process-wide 16-REQ budget; cancelled documents never retain queue slots. */
async function withSlot<T>(signal: AbortSignal, work: () => Promise<T>): Promise<T> {
  assertNotAborted(signal);
  if (active >= 16) await new Promise<void>((resolve, reject) => {
    if (waiters.length >= 128) { reject(new Error('sync-quota-exceeded')); return; }
    const item = { signal, start: () => { signal.removeEventListener('abort', item.cancel); resolve(); },
      cancel: () => { const index = waiters.indexOf(item); if (index >= 0) waiters.splice(index, 1); reject(new Error('session-closed')); } };
    waiters.push(item); signal.addEventListener('abort', item.cancel, { once: true });
  });
  else active++;
  try { assertNotAborted(signal); return await work(); }
  finally { const next = waiters.shift(); if (next) next.start(); else active--; }
}
type Range = [number, number];
export class NappSync {
  private ranges = new Map<string, Range[]>();
  private latest = new Map<string, true>();
  private locks = new Map<string, Promise<unknown>>();
  constructor(private data: NappData) {}
  async run(authorsInput: unknown, kindsInput: unknown, options: any = {}) {
    if (!Array.isArray(authorsInput) || authorsInput.length > 16 || authorsInput.some(key => !isPublicKey(key)) ||
      !Array.isArray(kindsInput) || kindsInput.length > 16 || kindsInput.some(kind => !Number.isInteger(kind) || kind < 0 || kind > 65535 || privateKinds.has(kind)) ||
      !options || typeof options !== 'object') throw new Error('invalid-sync-request');
    const authors: string[] = [...new Set(authorsInput)], kinds: number[] = [...new Set(kindsInput)];
    if (!authors.length || !kinds.length) return { success: false, newEvents: 0, error: 'sync: no valid authors or kinds' };
    for (const key of ['since', 'until', 'limit']) if (options[key] !== undefined && (!Number.isSafeInteger(options[key]) || options[key] < 0)) throw new Error('invalid-sync-options');
    const until = Math.min(options.until ?? Math.floor(Date.now() / 1000), Math.floor(Date.now() / 1000));
    const since = options.since ?? 0, limit = options.limit ?? (options.since === undefined ? 10 : undefined);
    if (limit !== undefined && (limit < 1 || limit > 10000)) throw new Error('invalid-sync-limit');
    if (since > until) return { success: true, newEvents: 0 };
    const queue = authors.flatMap(author => kinds.map(kind => ({ author, kind })));
    const errors: string[] = [];
    let newEvents = 0, admitted = 0;
    const deadline = Date.now() + 120000;
    await Promise.all(Array.from({ length: Math.min(queue.length, 4) }, async () => {
      for (let pair = queue.shift(); pair; pair = queue.shift()) {
        const { author, kind } = pair, key = `${author}:${kind}`;
        const work = (this.locks.get(key) ?? Promise.resolve()).catch(() => {}).then(async () => {
          this.data.check();
          const latestKey = JSON.stringify([key, since, until, limit]);
          if (limit !== undefined && this.latest.has(latestKey)) return;
          let segments: Range[] = [[since, until]];
          if (limit === undefined) for (const range of this.ranges.get(key) ?? []) segments = segments.flatMap(([lo, hi]): Range[] =>
            range[1] < lo || range[0] > hi ? [[lo, hi]] : [...(lo < range[0] ? [[lo, range[0] - 1] as Range] : []), ...(hi > range[1] ? [[range[1] + 1, hi] as Range] : [])]);
          if (!segments.length) return;
          const relays = (await this.data.network.routes([author], 'write', false, this.data.signal)).slice(0, 2);
          let found = 0;
          const seen = new Set<string>();
          for (const [lo, hi] of segments.reverse()) {
            let cursor = hi, complete = false;
            for (let page = 0; page < 20 && cursor >= lo; page++) {
              this.data.check();
              if (Date.now() >= deadline || admitted >= 10000) throw new Error('sync-budget-exceeded');
              const pageSize = Math.min(200, limit === undefined ? 200 : limit - found);
              const result = await withSlot(this.data.signal, () => this.data.query(relays,
                [{ authors: [author], kinds: [kind], since: lo, until: cursor, limit: pageSize }], 6000));
              const events = result.events.sort((a, b) => b.created_at - a.created_at || a.id.localeCompare(b.id)).slice(0, pageSize);
              const unique = events.filter(event => !seen.has(event.id));
              for (const event of unique) {
                seen.add(event.id);
                this.data.check();
                if (++admitted > 10000) throw new Error('sync-budget-exceeded');
                if (await localRelay.add(event)) newEvents++;
              }
              found += unique.length;
              if (result.incomplete) throw new Error('sync-incomplete');
              if (events.length < pageSize) { complete = true; break; }
              if (limit !== undefined && found >= limit) {
                if (this.latest.size >= 256) this.latest.delete(this.latest.keys().next().value!);
                this.latest.set(latestKey, true); return;
              }
              const oldest = events.at(-1)!.created_at;
              // The protocol has no event-id cursor. Never claim coverage if a timestamp bucket overflows.
              if (oldest === cursor) throw new Error('sync-timestamp-overflow');
              cursor = oldest;
            }
            if (!complete) throw new Error('sync-page-limit');
            const ranges = [...(this.ranges.get(key) ?? []), [lo, hi] as Range].sort((a, b) => a[0] - b[0]);
            const merged: Range[] = [];
            for (const range of ranges) { const prior = merged.at(-1); if (prior && prior[1] + 1 >= range[0]) prior[1] = Math.max(prior[1], range[1]); else merged.push([...range]); }
            if (this.ranges.size >= 256 && !this.ranges.has(key)) this.ranges.delete(this.ranges.keys().next().value!);
            this.ranges.set(key, merged.slice(-16));
          }
        });
        this.locks.set(key, work);
        try { await work; } catch (error) { errors.push(`${author.slice(0, 8)}/${kind}: ${error instanceof Error ? error.message : 'sync-failed'}`); }
        finally { if (this.locks.get(key) === work) this.locks.delete(key); }
      }
    }));
    this.data.check();
    return { success: errors.length === 0, newEvents, ...(errors.length ? { error: errors.slice(0, 3).join('; ') } : {}) };
  }
}
