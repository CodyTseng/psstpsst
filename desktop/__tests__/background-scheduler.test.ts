import { BackgroundScheduler } from '../background-scheduler';

const MINUTE = 60 * 1000;

function createScheduler(overrides: Partial<ConstructorParameters<typeof BackgroundScheduler>[0]> = {}) {
  const runs: string[] = [];
  const scheduler = new BackgroundScheduler({
    canRun: () => true,
    startRun: (runId) => runs.push(runId),
    newRunId: () => `run-${runs.length + 1}`,
    ...overrides,
  });
  return { scheduler, runs };
}

describe('desktop background scheduler', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('runs on cadence while every run ACKs in time', () => {
    const { scheduler, runs } = createScheduler();
    scheduler.start(15);

    jest.advanceTimersByTime(15 * MINUTE);
    expect(runs).toEqual(['run-1']);

    scheduler.complete('run-1');
    jest.advanceTimersByTime(15 * MINUTE);
    expect(runs).toEqual(['run-1', 'run-2']);

    scheduler.stop();
  });

  it('skips ticks while a run is still within its ACK timeout', () => {
    const { scheduler, runs } = createScheduler({ runTimeoutMs: 20 * MINUTE });
    scheduler.start(15);

    jest.advanceTimersByTime(15 * MINUTE);
    expect(runs).toEqual(['run-1']);

    // Still active (15 min < 20 min timeout): the tick is skipped.
    jest.advanceTimersByTime(15 * MINUTE);
    expect(runs).toEqual(['run-1']);

    scheduler.stop();
  });

  it('clears a stuck run after the ACK timeout and starts a fresh one', () => {
    const { scheduler, runs } = createScheduler();
    scheduler.start(15);

    jest.advanceTimersByTime(15 * MINUTE);
    expect(runs).toEqual(['run-1']);

    // No `backgroundComplete` ever arrives; the next tick (well past the
    // 2-minute timeout) must not stay blocked on the dead run.
    jest.advanceTimersByTime(15 * MINUTE);
    expect(runs).toEqual(['run-1', 'run-2']);

    scheduler.stop();
  });

  it('ignores stale ACKs and drops the in-flight run on abort', () => {
    const { scheduler, runs } = createScheduler({ runTimeoutMs: 60 * MINUTE });
    scheduler.start(15);

    jest.advanceTimersByTime(15 * MINUTE);
    scheduler.complete('run-999');
    jest.advanceTimersByTime(15 * MINUTE);
    expect(runs).toEqual(['run-1']); // stale ACK didn't free the slot

    scheduler.abort(); // renderer went away mid-run
    jest.advanceTimersByTime(15 * MINUTE);
    expect(runs).toEqual(['run-1', 'run-2']);

    scheduler.stop();
  });

  it('never starts a run while the window is unusable', () => {
    const { scheduler, runs } = createScheduler({ canRun: () => false });
    scheduler.start(15);

    jest.advanceTimersByTime(60 * MINUTE);
    expect(runs).toEqual([]);

    scheduler.stop();
  });
});
