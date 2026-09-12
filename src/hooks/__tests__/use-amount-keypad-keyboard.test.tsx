import { act, create, type ReactTestRenderer } from 'react-test-renderer';

import { useAmountKeypadKeyboard } from '../use-amount-keypad-keyboard';

let mockFocused = true;

jest.mock('expo-router', () => ({
  useFocusEffect: (effect: () => void | (() => void)) => {
    const { useEffect } = jest.requireActual('react');
    const focused = mockFocused;
    useEffect(() => focused ? effect() : undefined, [effect, focused]);
  },
}));
jest.mock('@/lib/platform', () => ({ IS_ELECTRON: true }));

describe('amount keypad physical keyboard', () => {
  let renderer: ReactTestRenderer | undefined;
  const listeners = new Set<(event: KeyboardEvent) => void>();
  const onDigit = jest.fn();
  const onDelete = jest.fn();
  const querySelector = jest.fn();
  const originalDocument = Object.getOwnPropertyDescriptor(globalThis, 'document');

  function Harness({ enabled = true }: { enabled?: boolean }) {
    useAmountKeypadKeyboard({ enabled, onDigit, onDelete });
    return null;
  }

  function keyDown(key: string, overrides: Partial<KeyboardEvent> = {}) {
    const event = { key, preventDefault: jest.fn(), ...overrides } as unknown as KeyboardEvent;
    act(() => listeners.forEach((listener) => listener(event)));
    return event;
  }

  beforeEach(() => {
    mockFocused = true;
    jest.clearAllMocks();
    querySelector.mockReturnValue(null);
    Object.defineProperty(globalThis, 'document', {
      configurable: true,
      value: {
        addEventListener: (_type: string, listener: (event: KeyboardEvent) => void) => listeners.add(listener),
        removeEventListener: (_type: string, listener: (event: KeyboardEvent) => void) => listeners.delete(listener),
        querySelector,
      },
    });
  });

  afterEach(() => {
    act(() => renderer?.unmount());
    renderer = undefined;
    expect(listeners.size).toBe(0);
    if (originalDocument) Object.defineProperty(globalThis, 'document', originalDocument);
    else Reflect.deleteProperty(globalThis, 'document');
  });

  it('routes main keyboard and numpad digits and deletion through the keypad handlers', () => {
    act(() => { renderer = create(<Harness />); });
    for (const [key, code] of [['1', 'Digit1'], ['2', 'Numpad2'], ['0', 'Numpad0']]) {
      expect(keyDown(key, { code }).preventDefault).toHaveBeenCalledTimes(1);
    }
    expect(onDigit.mock.calls).toEqual([['1'], ['2'], ['0']]);
    keyDown('Backspace');
    keyDown('Delete');
    expect(onDelete).toHaveBeenCalledTimes(2);
  });

  it('leaves shortcuts, composition, handled events, and other keys untouched', () => {
    act(() => { renderer = create(<Harness />); });
    for (const overrides of [
      { ctrlKey: true }, { metaKey: true }, { altKey: true },
      { isComposing: true }, { defaultPrevented: true },
    ]) {
      expect(keyDown('1', overrides).preventDefault).not.toHaveBeenCalled();
    }
    for (const key of ['Enter', 'Escape', '.', '-', 'a', 'ArrowLeft']) {
      expect(keyDown(key).preventDefault).not.toHaveBeenCalled();
    }
    expect(onDigit).not.toHaveBeenCalled();
    expect(onDelete).not.toHaveBeenCalled();
  });

  it('does not edit the amount while an editable field or modal owns input', () => {
    act(() => { renderer = create(<Harness />); });
    const target = { closest: jest.fn(() => ({})) } as unknown as EventTarget;
    expect(keyDown('5', { target }).preventDefault).not.toHaveBeenCalled();
    querySelector.mockReturnValue({});
    expect(keyDown('Backspace').preventDefault).not.toHaveBeenCalled();
    expect(onDigit).not.toHaveBeenCalled();
    expect(onDelete).not.toHaveBeenCalled();
  });

  it('listens only while the keypad is enabled and its screen is focused', () => {
    act(() => { renderer = create(<Harness enabled={false} />); });
    expect(listeners.size).toBe(0);
    act(() => { renderer?.update(<Harness />); });
    expect(listeners.size).toBe(1);
    mockFocused = false;
    act(() => { renderer?.update(<Harness />); });
    expect(listeners.size).toBe(0);
    mockFocused = true;
    act(() => { renderer?.update(<Harness />); });
    expect(listeners.size).toBe(1);
    act(() => { renderer?.update(<Harness enabled={false} />); });
    expect(listeners.size).toBe(0);
  });
});
