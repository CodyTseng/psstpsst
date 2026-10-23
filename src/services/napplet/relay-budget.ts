import { assertNotAborted } from '@/platform/abort';
import { publicUrl } from './protocol';

type Release = () => void;
type Waiter = { relays: string[]; resolve(release: Release): void; reject(error: Error): void; cleanup(): void };

/** Keep a bounded connection cache; idle historical destinations never exhaust active capacity. */
export class RelayBudget {
  private destinations = new Map<string, number>();
  private waiters: Waiter[] = [];
  private closed = false;
  private draining = false;
  constructor(private evict: (relays: string[]) => void, private limit = 24) {}
  private normalize(relays: readonly string[]) {
    const urls = new Set<string>();
    for (const relay of relays) {
      urls.add(publicUrl(relay, true));
      if (urls.size > this.limit) throw new Error('relay-quota-exceeded');
    }
    return [...urls];
  }
  tryAcquire(relays: readonly string[]): Release | undefined { return this.reserve(this.normalize(relays)); }
  private reserve(relays: string[]): Release | undefined {
    if (this.closed) throw new Error('session-closed');
    const requested = new Set(relays);
    const missing = relays.filter(url => !this.destinations.has(url)).length;
    const needed = Math.max(0, this.destinations.size + missing - this.limit);
    const idle: string[] = [];
    if (needed) {
      for (const [url, active] of this.destinations) if (!active && !requested.has(url)) {
        idle.push(url); if (idle.length === needed) break;
      }
      if (idle.length < needed) return;
    }
    for (const url of idle) this.destinations.delete(url);
    if (idle.length) this.evict(idle);
    for (const url of relays) this.destinations.set(url, (this.destinations.get(url) ?? 0) + 1);
    let released = false;
    return () => {
      if (released) return;
      released = true;
      for (const url of relays) {
        const active = this.destinations.get(url);
        if (active === undefined) continue;
        this.destinations.delete(url); this.destinations.set(url, active - 1);
      }
      this.drain();
    };
  }
  acquire(relays: readonly string[], signal: AbortSignal, timeout: number): Promise<Release> {
    assertNotAborted(signal);
    const urls = this.normalize(relays), release = this.reserve(urls);
    if (release) return Promise.resolve(release);
    if (this.waiters.length >= 64) return Promise.reject(new Error('relay-quota-exceeded'));
    return new Promise((resolve, reject) => {
      const remove = () => { const index = this.waiters.indexOf(waiter); if (index >= 0) this.waiters.splice(index, 1); };
      const abort = () => { remove(); waiter.cleanup(); reject(new Error('session-closed')); };
      const timer = setTimeout(() => { remove(); waiter.cleanup(); reject(new Error('relay-queue-timeout')); }, timeout);
      const waiter: Waiter = { relays: urls, resolve, reject, cleanup: () => { clearTimeout(timer); signal.removeEventListener('abort', abort); } };
      this.waiters.push(waiter); signal.addEventListener('abort', abort, { once: true });
      if (signal.aborted) abort();
    });
  }
  private drain() {
    if (this.closed || this.draining) return;
    this.draining = true;
    try {
      for (let index = 0; index < this.waiters.length;) {
        const waiter = this.waiters[index], release = this.reserve(waiter.relays);
        if (!release) { index++; continue; }
        this.waiters.splice(index, 1); waiter.cleanup(); waiter.resolve(release);
      }
    } finally { this.draining = false; }
  }
  close() {
    this.closed = true;
    for (const waiter of this.waiters.splice(0)) { waiter.cleanup(); waiter.reject(new Error('session-closed')); }
    this.destinations.clear();
  }
}
