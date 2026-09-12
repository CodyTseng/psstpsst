/**
 * Quiet-hours window math and defensive parsing. The pure minute-window
 * predicate covers same-day and overnight ranges; the storage reader must fall
 * back to a disabled default on corrupt or out-of-range values, because the
 * headless background task reads it too.
 */

import {
  DEFAULT_DND_WINDOW,
  getDndWindow,
  isDndActiveNow,
  isMinuteInDndWindow,
  setDndWindow,
  type DndWindow,
} from '../notification-prefs';

let mockStoredValue: string | null = null;

jest.mock('@/services/preferences/device-preferences.service', () => ({
  getDevicePreference: jest.fn(async () => mockStoredValue),
  setDevicePreference: jest.fn(async (_key: string, value: string) => {
    mockStoredValue = value;
  }),
}));

function makeWindow(overrides: Partial<DndWindow> = {}): DndWindow {
  return { enabled: true, startMinutes: 22 * 60, endMinutes: 8 * 60, ...overrides };
}

beforeEach(() => {
  mockStoredValue = null;
});

describe('isMinuteInDndWindow', () => {
  it('matches inside a same-day window and excludes the end minute', () => {
    const sameDay = makeWindow({ startMinutes: 9 * 60, endMinutes: 17 * 60 });

    expect(isMinuteInDndWindow(9 * 60, sameDay)).toBe(true);
    expect(isMinuteInDndWindow(16 * 60 + 59, sameDay)).toBe(true);
    expect(isMinuteInDndWindow(17 * 60, sameDay)).toBe(false);
    expect(isMinuteInDndWindow(8 * 60 + 59, sameDay)).toBe(false);
  });

  it('matches across midnight for an overnight window', () => {
    const overnight = makeWindow();

    expect(isMinuteInDndWindow(22 * 60, overnight)).toBe(true);
    expect(isMinuteInDndWindow(0, overnight)).toBe(true);
    expect(isMinuteInDndWindow(7 * 60 + 59, overnight)).toBe(true);
    expect(isMinuteInDndWindow(8 * 60, overnight)).toBe(false);
    expect(isMinuteInDndWindow(21 * 60 + 59, overnight)).toBe(false);
    expect(isMinuteInDndWindow(12 * 60, overnight)).toBe(false);
  });

  it('covers nothing when start equals end', () => {
    const empty = makeWindow({ startMinutes: 600, endMinutes: 600 });

    expect(isMinuteInDndWindow(600, empty)).toBe(false);
    expect(isMinuteInDndWindow(0, empty)).toBe(false);
  });
});

describe('getDndWindow', () => {
  it('returns the disabled default when nothing is stored', async () => {
    await expect(getDndWindow()).resolves.toEqual(DEFAULT_DND_WINDOW);
    expect(DEFAULT_DND_WINDOW.enabled).toBe(false);
  });

  it('round-trips a stored window', async () => {
    const stored = makeWindow({ startMinutes: 13 * 60 + 30, endMinutes: 21 * 60 });
    await setDndWindow(stored);

    await expect(getDndWindow()).resolves.toEqual(stored);
  });

  it('falls back to the default on corrupt JSON', async () => {
    mockStoredValue = '{not json';

    await expect(getDndWindow()).resolves.toEqual(DEFAULT_DND_WINDOW);
  });

  it.each([
    ['{"enabled":true,"startMinutes":-1,"endMinutes":60}'],
    ['{"enabled":true,"startMinutes":0,"endMinutes":1440}'],
    ['{"enabled":true,"startMinutes":1.5,"endMinutes":60}'],
    ['{"enabled":true,"startMinutes":"22:00","endMinutes":480}'],
  ])('falls back to the default on out-of-range value %s', async (value) => {
    mockStoredValue = value;

    await expect(getDndWindow()).resolves.toEqual(DEFAULT_DND_WINDOW);
  });

  it('keeps the stored times while treating a missing flag as disabled', async () => {
    mockStoredValue = '{"startMinutes":60,"endMinutes":120}';

    await expect(getDndWindow()).resolves.toEqual({
      enabled: false,
      startMinutes: 60,
      endMinutes: 120,
    });
  });
});

describe('isDndActiveNow', () => {
  it('is inactive while the window is disabled', async () => {
    await setDndWindow(makeWindow({ enabled: false }));

    await expect(isDndActiveNow()).resolves.toBe(false);
  });

  it('is inactive when no preference was ever stored', async () => {
    await expect(isDndActiveNow()).resolves.toBe(false);
  });
});
