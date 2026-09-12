import { randomUUID } from 'node:crypto';

/** How long a run may go without its `backgroundComplete` ACK before the next
 * tick is allowed to start a fresh one — a wedged or crashed renderer must not
 * starve every later tick forever. */
export const BACKGROUND_RUN_TIMEOUT_MS = 2 * 60 * 1000;

/** The OS-style floor for the poll cadence, in minutes. */
const MINIMUM_INTERVAL_MINUTES = 15;

export type BackgroundSchedulerOptions = {
  /** Whether the renderer window is usable right now (exists, not destroyed). */
  canRun(): boolean;
  /** Deliver a run request to the renderer. */
  startRun(runId: string): void;
  /** Run-id minting, injectable for tests. */
  newRunId?: () => string;
  /** Clock, injectable for tests. */
  now?: () => number;
  /** ACK timeout override for tests; defaults to BACKGROUND_RUN_TIMEOUT_MS. */
  runTimeoutMs?: number;
};

/**
 * The desktop background poll: a main-process `setInterval` that asks the
 * renderer to run the poll task. Only one run is in flight at a time; the
 * renderer ACKs completion over IPC. If the ACK never arrives, the run is
 * considered dead once `runTimeoutMs` has elapsed and later ticks resume.
 */
export class BackgroundScheduler {
  private timer: ReturnType<typeof setInterval> | null = null;
  private activeRunId: string | null = null;
  private activeRunStartedAt = 0;
  private readonly runTimeoutMs: number;

  constructor(private readonly options: BackgroundSchedulerOptions) {
    this.runTimeoutMs = options.runTimeoutMs ?? BACKGROUND_RUN_TIMEOUT_MS;
  }

  start(minimumIntervalMinutes: number): void {
    this.stopTimer();

    const intervalMs = Math.max(MINIMUM_INTERVAL_MINUTES, minimumIntervalMinutes) * 60 * 1000;
    const timer = setInterval(this.tick, intervalMs);
    // Never hold the process open for the poll; absent under fake timer
    // implementations (jsdom-style number handles).
    if (typeof (timer as Partial<NodeJS.Timeout>).unref === 'function') {
      (timer as NodeJS.Timeout).unref();
    }
    this.timer = timer;
  }

  stop(): void {
    this.stopTimer();
    this.activeRunId = null;
  }

  /** The renderer finished a run; clear it so the next tick can run again. */
  complete(runId: string): void {
    if (runId === this.activeRunId) this.activeRunId = null;
  }

  /** The renderer went away mid-run (webContents destroyed); drop the run. */
  abort(): void {
    this.activeRunId = null;
  }

  private stopTimer(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  private tick = (): void => {
    if (!this.options.canRun()) return;

    const now = (this.options.now ?? Date.now)();
    if (this.activeRunId !== null && now - this.activeRunStartedAt < this.runTimeoutMs) {
      return;
    }

    this.activeRunId = (this.options.newRunId ?? randomUUID)();
    this.activeRunStartedAt = now;
    this.options.startRun(this.activeRunId);
  };
}
