import { publicUrl } from './protocol';

/** Retain every active destination; bound only the reusable idle connection cache. */
export class RelayBudget {
  private active = new Map<string, number>();
  private idle = new Set<string>();
  private closed = false;
  constructor(private evict: (relays: string[]) => void, private idleLimit = 24) {}
  retain(relays: readonly string[]): () => void {
    if (this.closed) throw new Error('session-closed');
    const urls = [...new Set(relays.map(url => publicUrl(url, true)))];
    for (const url of urls) {
      this.idle.delete(url);
      this.active.set(url, (this.active.get(url) ?? 0) + 1);
    }
    let released = false;
    return () => {
      if (released || this.closed) return;
      released = true;
      for (const url of urls) {
        const count = this.active.get(url)! - 1;
        if (count) this.active.set(url, count);
        else { this.active.delete(url); this.idle.add(url); }
      }
      const evicted: string[] = [];
      while (this.idle.size > this.idleLimit) {
        const url = this.idle.values().next().value!;
        this.idle.delete(url); evicted.push(url);
      }
      if (evicted.length) this.evict(evicted);
    };
  }
  close() { this.closed = true; this.active.clear(); this.idle.clear(); }
}
