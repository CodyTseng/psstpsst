import { BackgroundDeadlineScheduler } from '../background-deadline';

let mockState = 'background';
let mockPulse: () => void;
let mockStateChanged: () => void;
const mockSchedule = jest.fn(async (_at: number | null) => {});
jest.mock('@/platform', () => ({
  platform: {
    backgroundMessaging: {
      isAvailable: () => true,
      addPulseListener: (listener: () => void) => { mockPulse = listener; return () => {}; },
      schedulePulse: (at: number | null) => mockSchedule(at),
    },
    appState: {
      currentState: () => mockState,
      addChangeListener: (listener: () => void) => { mockStateChanged = listener; return () => {}; },
    },
  },
}));

async function flush() { for (let i = 0; i < 12; i++) await Promise.resolve(); }

beforeEach(() => {
  jest.useFakeTimers();
  mockState = 'background';
  mockSchedule.mockClear();
});
afterEach(() => jest.useRealTimers());

it('arms only the earliest deadline and cancels the native clock when empty', async () => {
  const scheduler = new BackgroundDeadlineScheduler();
  const now = Date.now();
  const cancelLater = scheduler.schedule(jest.fn(), 5_000);
  const cancelEarlier = scheduler.schedule(jest.fn(), 1_000);
  await flush();
  expect(mockSchedule.mock.calls).toEqual([[now + 1_000]]);
  cancelEarlier();
  await flush();
  expect(mockSchedule).toHaveBeenLastCalledWith(now + 5_000);
  cancelLater();
  await flush();
  expect(mockSchedule).toHaveBeenLastCalledWith(null);
  expect(jest.getTimerCount()).toBe(0);
});

it('executes due work once when native delivery races a suspended RN timer', async () => {
  const scheduler = new BackgroundDeadlineScheduler();
  const run = jest.fn();
  const cancel = scheduler.schedule(run, 1_000);
  jest.setSystemTime(Date.now() + 1_000);
  mockPulse();
  mockPulse();
  await jest.advanceTimersByTimeAsync(1_000);
  cancel();
  expect(run).toHaveBeenCalledTimes(1);
  expect(jest.getTimerCount()).toBe(0);
});

it('uses RN timers in the foreground and rearms pending work on background entry', async () => {
  mockState = 'active';
  const scheduler = new BackgroundDeadlineScheduler();
  const run = jest.fn();
  const now = Date.now();
  scheduler.schedule(run, 1_000);
  await flush();
  expect(mockSchedule).not.toHaveBeenCalled();
  mockState = 'background';
  mockStateChanged();
  await flush();
  expect(mockSchedule).toHaveBeenLastCalledWith(now + 1_000);
  mockState = 'active';
  mockStateChanged();
  await flush();
  expect(mockSchedule).toHaveBeenLastCalledWith(null);
  await jest.advanceTimersByTimeAsync(1_000);
  expect(run).toHaveBeenCalledTimes(1);
});

it('rearms after an early pulse and ignores cancelled work', async () => {
  const scheduler = new BackgroundDeadlineScheduler();
  const run = jest.fn();
  const now = Date.now();
  const cancel = scheduler.schedule(run, 1_000);
  await flush();
  mockPulse();
  await flush();
  expect(mockSchedule).toHaveBeenLastCalledWith(now + 1_000);
  expect(run).not.toHaveBeenCalled();
  cancel();
  jest.setSystemTime(now + 2_000);
  mockPulse();
  expect(run).not.toHaveBeenCalled();
});
