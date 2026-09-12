type WrappedTask = () => Promise<number>;

let mockWrappedTask: WrappedTask | null = null;
let mockExpirationListener: (() => void) | null = null;
const mockRemoveExpirationListener = jest.fn();

jest.mock('@/lib/platform', () => ({ IS_IOS: true }));

jest.mock('expo-task-manager', () => ({
  defineTask: jest.fn((_name: string, task: WrappedTask) => {
    mockWrappedTask = task;
  }),
}));

jest.mock('expo-background-task', () => ({
  BackgroundTaskResult: { Success: 1, Failed: 2 },
  addExpirationListener: jest.fn((listener: () => void) => {
    mockExpirationListener = listener;
    return { remove: mockRemoveExpirationListener };
  }),
  registerTaskAsync: jest.fn(async () => {}),
  unregisterTaskAsync: jest.fn(async () => {}),
}));

// eslint-disable-next-line import/first -- load the adapter after its native modules are mocked
import { backgroundTaskAdapter } from '../background-task';

describe('Expo background-task adapter', () => {
  beforeEach(() => {
    mockWrappedTask = null;
    mockExpirationListener = null;
    mockRemoveExpirationListener.mockClear();
  });

  it('aborts the execution signal when iOS expires its background window', async () => {
    const observed: { signal?: AbortSignal } = {};
    backgroundTaskAdapter.defineTasks(['notification-poll'], async ({ signal }) => {
      observed.signal = signal;
      await new Promise<void>((resolve) => {
        signal.addEventListener('abort', () => resolve(), { once: true });
      });
    });

    const result = mockWrappedTask!();
    await Promise.resolve();
    mockExpirationListener!();

    await expect(result).resolves.toBe(1);
    expect(observed.signal?.aborted).toBe(true);
    expect(mockRemoveExpirationListener).toHaveBeenCalledTimes(1);
  });
});
