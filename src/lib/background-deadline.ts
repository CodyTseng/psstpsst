import { platform } from '@/platform';

type Deadline = {
  at: number;
  timer: ReturnType<typeof setTimeout>;
  run(): void;
};

/** RN timers normally run the work; one native deadline backs them up on Android
 * vendors that suspend Choreographer in the background. Entries represent small
 * control tasks, never messages or history rows. Nothing ticks while idle. */
export class BackgroundDeadlineScheduler {
  private readonly pending = new Set<Deadline>();
  private listening = false;
  private nativeDeadline: number | null = null;
  private nativeUpdate = Promise.resolve();

  schedule(callback: () => void, delayMs: number): () => void {
    this.listen();
    const entry: Deadline = {
      at: Date.now() + delayMs,
      timer: setTimeout(() => entry.run(), delayMs),
      run: () => {
        if (!this.pending.delete(entry)) return;
        clearTimeout(entry.timer);
        this.updateNativeDeadline();
        callback();
      },
    };
    this.pending.add(entry);
    this.updateNativeDeadline();
    return () => {
      if (!this.pending.delete(entry)) return;
      clearTimeout(entry.timer);
      this.updateNativeDeadline();
    };
  }

  private listen(): void {
    if (this.listening || !platform.backgroundMessaging.isAvailable()) return;
    this.listening = true;
    platform.backgroundMessaging.addPulseListener(() => {
      this.nativeDeadline = null;
      const now = Date.now();
      // Snapshot so a callback cannot recursively run newly scheduled work.
      for (const entry of Array.from(this.pending)) {
        if (entry.at <= now) entry.run();
      }
      this.updateNativeDeadline();
    });
    platform.appState.addChangeListener(() => this.updateNativeDeadline());
  }

  private updateNativeDeadline(): void {
    if (!this.listening) return;
    let next: number | null = null;
    if (platform.appState.currentState() !== 'active') {
      for (const entry of this.pending) {
        if (next === null || entry.at < next) next = entry.at;
      }
    }
    if (next === this.nativeDeadline) return;
    this.nativeDeadline = next;
    // Serialize native writes and coalesce updates made within one JS turn.
    this.nativeUpdate = this.nativeUpdate.then(async () => {
      if (this.nativeDeadline !== next) return;
      await platform.backgroundMessaging.schedulePulse(next);
    }).catch((error) => {
      console.warn('[background] Unable to schedule a native deadline.', error);
      if (this.nativeDeadline === next) this.nativeDeadline = null;
    });
  }
}

const scheduler = new BackgroundDeadlineScheduler();

export function scheduleBackgroundDeadline(callback: () => void, delayMs: number): () => void {
  return scheduler.schedule(callback, delayMs);
}
