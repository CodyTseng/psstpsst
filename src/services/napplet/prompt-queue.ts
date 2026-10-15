import type { RuntimePrompt } from './runtime';

export type QueuedPrompt = RuntimePrompt & { requestId: string; expiresAt: number; queued: number };
type Entry = {
  prompt: QueuedPrompt;
  finish: (value: string | false) => void;
  cleanup: () => void;
  timer?: ReturnType<typeof setTimeout>;
};

/** One visible request; each approval gets its review budget when it becomes visible. */
export class PromptQueue {
  private entries: Entry[] = [];
  private serial = 0;
  private paused = false;
  private blockedUntil = 0;
  constructor(private changed: (prompt: QueuedPrompt | null) => void) {}

  ask(value: RuntimePrompt, signal?: AbortSignal): Promise<string | false> {
    if (signal?.aborted || Date.now() < this.blockedUntil) return Promise.resolve(false);
    if (this.entries.length >= 16) return Promise.reject(new Error('quota-exceeded'));
    return new Promise((resolve) => {
      const id = `approval:${++this.serial}`;
      const abort = () => this.remove(id, false);
      const entry: Entry = {
        prompt: { ...value, requestId: id, expiresAt: 0, queued: 0 },
        finish: resolve,
        cleanup: () => {
          if (entry.timer !== undefined) clearTimeout(entry.timer);
          signal?.removeEventListener('abort', abort);
        },
      };
      this.entries.push(entry);
      signal?.addEventListener('abort', abort, { once: true });
      this.emit();
    });
  }

  answer(id: string, value: string | false): void {
    const first = this.entries[0];
    if (first?.prompt.requestId === id) {
      this.remove(id, Date.now() < first.prompt.expiresAt ? value : false);
    }
  }

  setPaused(paused: boolean): void {
    this.paused = paused;
    this.emit();
  }

  cancelAll(): void {
    this.paused = false;
    this.blockedUntil = 0;
    const entries = this.entries;
    this.entries = [];
    for (const entry of entries) { entry.cleanup(); entry.finish(false); }
    this.emit();
  }
  rejectAll(): void {
    this.cancelAll();
    this.blockedUntil = Date.now() + 60000;
  }

  private remove(id: string, value: string | false) {
    const index = this.entries.findIndex((entry) => entry.prompt.requestId === id);
    if (index < 0) return;
    const [entry] = this.entries.splice(index, 1);
    entry.cleanup();
    entry.finish(value);
    this.emit();
  }

  private emit() {
    if (this.paused) { this.changed(null); return; }
    const first = this.entries[0];
    if (first && first.timer === undefined) {
      first.prompt.expiresAt = Date.now() + 25000;
      first.timer = setTimeout(() => this.remove(first.prompt.requestId, false), 25000);
    }
    this.changed(first ? { ...first.prompt, queued: this.entries.length - 1 } : null);
  }
}
