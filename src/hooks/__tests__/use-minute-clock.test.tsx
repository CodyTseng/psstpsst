import { act, create, type ReactTestRenderer } from 'react-test-renderer';

import type { AppStateStatus } from '@/platform';
import { useMinuteClock } from '../use-minute-clock';

let mockAppState: AppStateStatus = 'active';
const mockListeners = new Set<(state: AppStateStatus) => void>();

jest.mock('@/platform', () => ({
  platform: {
    appState: {
      currentState: () => mockAppState,
      addChangeListener: (listener: (state: AppStateStatus) => void) => {
        mockListeners.add(listener);
        return () => mockListeners.delete(listener);
      },
    },
  },
}));

describe('minute clock', () => {
  let renderer: ReactTestRenderer | undefined;
  let minute: number;
  let renders: number;

  function Harness({ enabled = true }: { enabled?: boolean }) {
    minute = useMinuteClock(enabled);
    renders += 1;
    return null;
  }

  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-09-17T12:00:30.000Z'));
    mockAppState = 'active';
    renders = 0;
  });

  afterEach(() => {
    act(() => renderer?.unmount());
    renderer = undefined;
    expect(mockListeners.size).toBe(0);
    jest.useRealTimers();
  });

  it('ticks at the next wall-clock minute while enabled', () => {
    act(() => { renderer = create(<Harness />); });
    const initialMinute = minute;
    const initialRenders = renders;

    act(() => jest.advanceTimersByTime(29_999));
    expect(minute).toBe(initialMinute);
    expect(renders).toBe(initialRenders);

    act(() => jest.advanceTimersByTime(1));
    expect(minute).toBe(initialMinute + 1);
    expect(renders).toBe(initialRenders + 1);
  });

  it('pauses in the background and catches up immediately on return', () => {
    act(() => { renderer = create(<Harness />); });
    const initialMinute = minute;

    act(() => {
      mockAppState = 'background';
      mockListeners.forEach((listener) => listener(mockAppState));
      jest.advanceTimersByTime(5 * 60_000);
    });
    expect(minute).toBe(initialMinute);

    act(() => {
      mockAppState = 'active';
      mockListeners.forEach((listener) => listener(mockAppState));
    });
    expect(minute).toBe(initialMinute + 5);
  });

  it('does not subscribe or schedule while disabled', () => {
    act(() => { renderer = create(<Harness enabled={false} />); });
    const initialMinute = minute;
    expect(mockListeners.size).toBe(0);

    act(() => jest.advanceTimersByTime(60_000));
    expect(minute).toBe(initialMinute);
    expect(renders).toBe(1);
  });
});
