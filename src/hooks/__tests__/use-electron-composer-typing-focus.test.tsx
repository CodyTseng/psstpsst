import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import type { TextInput } from 'react-native';

import { useElectronComposerTypingFocus } from '../use-electron-composer-typing-focus';

jest.mock('@/lib/platform', () => ({ IS_ELECTRON: true }));

describe('Electron composer typing focus', () => {
  let renderer: ReactTestRenderer | undefined;
  const listeners = new Set<(event: KeyboardEvent) => void>();
  const focus = jest.fn();
  const inputRef = { current: { focus } as unknown as TextInput };
  const querySelector = jest.fn();
  const originalDocument = Object.getOwnPropertyDescriptor(globalThis, 'document');

  function Harness({ enabled = true }: { enabled?: boolean }) {
    useElectronComposerTypingFocus({ enabled, inputRef });
    return null;
  }

  function keyDown(key: string, overrides: Partial<KeyboardEvent> = {}) {
    const event = { key, preventDefault: jest.fn(), ...overrides } as unknown as KeyboardEvent;
    act(() => listeners.forEach((listener) => listener(event)));
    return event;
  }

  beforeEach(() => {
    jest.clearAllMocks();
    querySelector.mockReturnValue(null);
    Object.defineProperty(globalThis, 'document', {
      configurable: true,
      value: {
        addEventListener: (_type: string, listener: (event: KeyboardEvent) => void) =>
          listeners.add(listener),
        removeEventListener: (_type: string, listener: (event: KeyboardEvent) => void) =>
          listeners.delete(listener),
        querySelector,
      },
    });
  });

  afterEach(() => {
    act(() => renderer?.unmount());
    renderer = undefined;
    listeners.clear();
    if (originalDocument) Object.defineProperty(globalThis, 'document', originalDocument);
    else Reflect.deleteProperty(globalThis, 'document');
  });

  it('focuses the composer for printable typing without consuming the character', () => {
    act(() => {
      renderer = create(<Harness />);
    });

    const events = ['a', 'A', '中', ' ', 'Dead'].map((key) =>
      keyDown(key, { shiftKey: key === 'A' }),
    );

    expect(focus).toHaveBeenCalledTimes(5);
    for (const event of events) expect(event.preventDefault).not.toHaveBeenCalled();
  });

  it('leaves shortcuts, handled keys, composition, and navigation untouched', () => {
    act(() => {
      renderer = create(<Harness />);
    });

    for (const overrides of [
      { ctrlKey: true },
      { metaKey: true },
      { altKey: true },
      { isComposing: true },
      { defaultPrevented: true },
    ]) {
      keyDown('k', overrides);
    }
    for (const key of ['Enter', 'Escape', 'ArrowLeft', 'Backspace', 'Tab']) keyDown(key);

    expect(focus).not.toHaveBeenCalled();
  });

  it('does not steal input from another editor or a modal task', () => {
    act(() => {
      renderer = create(<Harness />);
    });

    const target = { closest: jest.fn(() => ({})) } as unknown as EventTarget;
    keyDown('a', { target });
    querySelector.mockReturnValue({});
    keyDown('b');

    expect(focus).not.toHaveBeenCalled();
  });

  it('listens only while the composer can accept typing', () => {
    act(() => {
      renderer = create(<Harness enabled={false} />);
    });
    expect(listeners.size).toBe(0);

    act(() => {
      renderer?.update(<Harness />);
    });
    expect(listeners.size).toBe(1);

    act(() => {
      renderer?.update(<Harness enabled={false} />);
    });
    expect(listeners.size).toBe(0);
  });
});
