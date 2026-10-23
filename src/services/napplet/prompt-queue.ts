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
  private dismissing?: { entry: Entry; value: string | false };
  constructor(private changed: (prompt: QueuedPrompt | null, closing: boolean) => void) {}

  ask(value: RuntimePrompt, signal?: AbortSignal): Promise<string | false> {
    if (signal?.aborted || Date.now() < this.blockedUntil) return Promise.resolve(false);
    if (this.entries.length + (this.dismissing ? 1 : 0) >= 16) return Promise.reject(new Error('quota-exceeded'));
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
    if (!this.dismissing && first?.prompt.requestId === id && first.prompt.expiresAt > 0) {
      this.remove(id, Date.now() < first.prompt.expiresAt ? value : false);
    }
  }

  setPaused(paused: boolean): void {
    this.paused = paused;
    this.emit();
  }

  /** The sheet's exit completion releases the decision before another review starts. */
  dismissed(): void {
    const closing = this.dismissing;
    if (!closing) return;
    this.dismissing = undefined;
    closing.entry.finish(closing.value);
    this.emit();
  }

  cancelAll(): void {
    this.paused = false;
    this.blockedUntil = 0;
    const entries = this.entries;
    this.entries = [];
    const closing = this.dismissing;
    this.dismissing = undefined;
    closing?.entry.finish(false);
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
    if (index === 0 && entry.prompt.expiresAt > 0) this.dismissing = { entry, value };
    else entry.finish(value);
    this.emit();
  }

  private emit() {
    if (this.paused || this.dismissing) { this.changed(null, !!this.dismissing); return; }
    const first = this.entries[0];
    if (first && first.timer === undefined) {
      first.prompt.expiresAt = Date.now() + 60000;
      first.timer = setTimeout(() => this.remove(first.prompt.requestId, false), 60000);
    }
    this.changed(first ? { ...first.prompt, queued: this.entries.length - 1 } : null, false);
  }
}
