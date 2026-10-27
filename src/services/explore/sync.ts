import { assertNotAborted } from '@/platform/abort';
import { localRelay } from '@/services/local-relay';
import type { NappData } from './data';
import { isPublicKey } from './lists';
import type { Event } from 'nostr-tools';

const privateKinds = new Set([4, 13, 14, 15, 1059]);
const SYNC_CONCURRENCY = 16;
let active = 0;
const waiters: { signal: AbortSignal; start(): void; cancel(): void }[] = [];
/** Syncs share a process-wide 16-REQ budget; cancelled documents never retain queue slots. */
async function withSlot<T>(signal: AbortSignal, work: () => Promise<T>): Promise<T> {
  assertNotAborted(signal);
  if (active >= SYNC_CONCURRENCY) await new Promise<void>((resolve, reject) => {
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
  constructor(private data: NappData, private diagnostic: (phase: string, details: object) => void = () => {}) {}
  async run(authorsInput: unknown, kindsInput: unknown, options: any = {}) {
    if (!Array.isArray(authorsInput) || authorsInput.some(key => !isPublicKey(key)) ||
      !Array.isArray(kindsInput) || kindsInput.some(kind => !Number.isInteger(kind) || kind < 0 || kind > 65535 || privateKinds.has(kind)) ||
      !options || typeof options !== 'object') throw new Error('invalid-sync-request');
    const authors: string[] = [...new Set(authorsInput)], kinds: number[] = [...new Set(kindsInput)];
    if (!authors.length || !kinds.length) return { success: false, newEvents: 0, error: 'sync: no valid authors or kinds' };
    for (const key of ['since', 'until', 'limit']) if (options[key] !== undefined &&
      (!Number.isSafeInteger(options[key]) || key === 'limit' && options[key] < 0)) throw new Error('invalid-sync-options');
    const until = options.until ?? Math.floor(Date.now() / 1000);
    const since = options.since ?? 0, limit = options.limit ?? (options.since === undefined ? 10 : undefined);
    if (since > until || limit === 0) return { success: true, newEvents: 0 };
    if (limit === undefined) return this.fullRange(authors, kinds, since, until);
    const total = authors.length * kinds.length;
    let offset = 0;
    const errors: string[] = [];
    let newEvents = 0;
    await Promise.all(Array.from({ length: Math.min(total, SYNC_CONCURRENCY) }, async () => {
      while (offset < total) {
        const index = offset++;
        const author = authors[Math.floor(index / kinds.length)], kind = kinds[index % kinds.length], key = `${author}:${kind}`;
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
          let saving = Promise.resolve(), saveError: unknown;
          const collect = (event: Event) => {
            if (seen.has(event.id) || seen.size >= limit) return;
            seen.add(event.id);
            saving = saving.then(async () => {
              this.data.check();
              if (await localRelay.add(event)) {
                newEvents++;
                if (newEvents === 1 || newEvents % 100 === 0) this.diagnostic('progress', { newEvents });
              }
            }).catch(error => { saveError = error; });
          };
          for (const [lo, hi] of segments.reverse()) {
            let cursor = hi, complete = false;
            while (cursor >= lo) {
              this.data.check();
              const pageSize = Math.min(200, limit === undefined ? 200 : limit - found);
              const pages = await Promise.allSettled(relays.map(relay => withSlot(this.data.signal, async () => {
                try { return await this.data.query([relay],
                  [{ authors: [author], kinds: [kind], since: lo, until: cursor, limit: pageSize }], 6000, collect); }
                finally { await saving; }
              })));
              const mergedEvents = new Map<string, Event>();
              let incomplete = false;
              for (const page of pages) {
                if (page.status === 'rejected') { incomplete = true; continue; }
                incomplete ||= page.value.incomplete;
                for (const event of page.value.events) mergedEvents.set(event.id, event);
              }
              const result = { events: [...mergedEvents.values()], incomplete };
              const events = result.events.sort((a, b) => b.created_at - a.created_at || a.id.localeCompare(b.id)).slice(0, pageSize);
              for (const event of result.events) collect(event);
              await saving;
              if (saveError) throw saveError;
              found = seen.size;
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
            if (!complete) throw new Error('sync-incomplete');
            const ranges = [...(this.ranges.get(key) ?? []), [lo, hi] as Range].sort((a, b) => a[0] - b[0]);
            const merged: Range[] = [];
            for (const range of ranges) { const prior = merged.at(-1); if (prior && prior[1] + 1 >= range[0]) prior[1] = Math.max(prior[1], range[1]); else merged.push([...range]); }
            this.ranges.set(key, merged.slice(-16));
          }
        });
        this.locks.set(key, work);
        try { await work; } catch (error) { errors.push(`${author.slice(0, 8)}/${kind}: ${error instanceof Error ? error.message : 'sync-failed'}`); }
        finally { if (this.locks.get(key) === work) this.locks.delete(key); }
      }
    }));
    this.data.check();
    return { success: errors.length === 0, newEvents, ...(errors.length ? { error: errors.join('; ') } : {}) };
  }
  private async fullRange(authors: string[], kinds: number[], since: number, until: number) {
    const keys = authors.flatMap(author => kinds.map(kind => `${author}:${kind}`));
    const previous = [...new Set(keys.flatMap(key => { const work = this.locks.get(key); return work ? [work] : []; }))];
    const work = Promise.all(previous.map(pending => pending.catch(() => {}))).then(() => this.fetchRange(authors, kinds, since, until));
    for (const key of keys) this.locks.set(key, work);
    try { return await work; }
    finally { for (const key of keys) if (this.locks.get(key) === work) this.locks.delete(key); }
  }
  private async fetchRange(authors: string[], kinds: number[], since: number, until: number) {
    type Coverage = { key: string; range: Range; expected: number; completed: number };
    type Segment = { range: Range; kinds: Map<number, Coverage> };
    type Job = { relay: string; range: Range; kinds: number[]; authors: string[]; coverage: Coverage[] };
    const pending = new Map<string, Map<string, Segment>>(), coverage: Coverage[] = [];
    for (const author of authors) for (const kind of kinds) {
      const key = `${author}:${kind}`;
      let missing: Range[] = [[since, until]];
      for (const [lo, hi] of this.ranges.get(key) ?? []) missing = missing.flatMap(([start, end]): Range[] =>
        hi < start || lo > end ? [[start, end]] : [...(start < lo ? [[start, lo - 1] as Range] : []), ...(end > hi ? [[hi + 1, end] as Range] : [])]);
      for (const range of missing) {
        const intervals = pending.get(author) ?? new Map<string, Segment>(), intervalKey = range.join(':');
        const segment = intervals.get(intervalKey) ?? { range, kinds: new Map<number, Coverage>() };
        const item = { key, range, expected: 0, completed: 0 };
        coverage.push(item); segment.kinds.set(kind, item); intervals.set(intervalKey, segment); pending.set(author, intervals);
      }
    }
    if (!pending.size) return { success: true, newEvents: 0 };
    const routes = await this.data.network.outboxRoutes([...pending.keys()], this.data.signal), grouped = new Map<string, Job>();
    this.data.check();
    for (const [relay, routed] of routes) for (const author of routed) for (const segment of pending.get(author)?.values() ?? []) {
      const groupKinds = [...segment.kinds.keys()].sort((a, b) => a - b), key = JSON.stringify([relay, segment.range, groupKinds]);
      const job = grouped.get(key) ?? { relay, range: segment.range, kinds: groupKinds, authors: [], coverage: [] };
      job.authors.push(author);
      for (const item of segment.kinds.values()) { item.expected++; job.coverage.push(item); }
      grouped.set(key, job);
    }
    const jobs = [...grouped.values()].sort((a, b) => b.authors.length - a.authors.length), errors: string[] = [];
    let offset = 0, newEvents = 0, finished = 0;
    this.diagnostic('plan', { authors: pending.size, kinds: kinds.length, relays: routes.size, requests: jobs.length });
    await Promise.all(Array.from({ length: Math.min(jobs.length, SYNC_CONCURRENCY) }, async () => {
      while (offset < jobs.length) {
        const job = jobs[offset++], [lo, hi] = job.range;
        let cursor = hi, saving = Promise.resolve(), saveError: unknown;
        const seen = new Set<string>();
        const collect = (event: Event) => {
          if (seen.has(event.id)) return;
          seen.add(event.id);
          saving = saving.then(async () => {
            this.data.check();
            if (await localRelay.add(event)) {
              newEvents++;
              if (newEvents === 1 || newEvents % 100 === 0) this.diagnostic('progress', { newEvents, completedRequests: finished, requests: jobs.length });
            }
          }).catch(error => { saveError = error; });
        };
        try {
          while (cursor >= lo) {
            this.data.check();
            const result = await withSlot(this.data.signal, async () => {
              try { return await this.data.query([job.relay], [{ authors: job.authors, kinds: job.kinds, since: lo, until: cursor, limit: 200 }], 6000, collect); }
              finally { await saving; }
            });
            for (const event of result.events) collect(event);
            await saving;
            if (saveError) throw saveError;
            if (result.incomplete) throw new Error('sync-incomplete');
            if (result.events.length < 200) break;
            const oldest = result.events.reduce((value, event) => Math.min(value, event.created_at), cursor);
            if (oldest >= cursor) throw new Error('sync-timestamp-overflow');
            cursor = oldest;
          }
          for (const item of job.coverage) item.completed++;
        } catch (error) {
          errors.push(`${job.relay}: ${error instanceof Error ? error.message : 'sync-failed'}`);
        }
        finished++;
      }
    }));
    this.data.check();
    for (const item of coverage) if (item.expected && item.completed === item.expected) {
      const ranges = [...(this.ranges.get(item.key) ?? []), item.range].sort((a, b) => a[0] - b[0]), merged: Range[] = [];
      for (const range of ranges) { const prior = merged.at(-1); if (prior && prior[1] + 1 >= range[0]) prior[1] = Math.max(prior[1], range[1]); else merged.push([...range]); }
      this.ranges.set(item.key, merged.slice(-16));
    }
    return { success: errors.length === 0, newEvents, ...(errors.length ? { error: errors.join('; ') } : {}) };
  }
}
