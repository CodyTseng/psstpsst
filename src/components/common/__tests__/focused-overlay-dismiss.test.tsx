import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { BackHandler, Platform } from 'react-native';

import { useFocusedOverlayDismiss } from '../use-focused-overlay-dismiss';

let mockFocused = true;

jest.mock('expo-router', () => ({
  useFocusEffect: (effect: () => void | (() => void)) => {
    const { useEffect } = jest.requireActual('react');
    const focused = mockFocused;
    useEffect(() => (focused ? effect() : undefined), [effect, focused]);
  },
}));

function DismissHarness({ active, onDismiss }: { active: boolean; onDismiss: () => void }) {
  useFocusedOverlayDismiss(active, onDismiss);
  return null;
}

describe('useFocusedOverlayDismiss', () => {
  let renderer: ReactTestRenderer | null = null;
  let backPress: Parameters<typeof BackHandler.addEventListener>[1] = () => false;
  const removeBackListener = jest.fn();
  const keyListeners = new Set<(event: KeyboardEvent) => void>();
  const originalPlatform = Platform.OS;
  const originalDocument = Object.getOwnPropertyDescriptor(globalThis, 'document');

  beforeEach(() => {
    mockFocused = true;
    jest.clearAllMocks();
    Object.defineProperty(Platform, 'OS', { configurable: true, value: 'android' });
    jest.spyOn(BackHandler, 'addEventListener').mockImplementation((_event, handler) => {
      backPress = handler;
      return { remove: removeBackListener };
    });
    Object.defineProperty(globalThis, 'document', {
      configurable: true,
      value: {
        addEventListener: (_type: string, listener: (event: KeyboardEvent) => void) =>
          keyListeners.add(listener),
        removeEventListener: (_type: string, listener: (event: KeyboardEvent) => void) =>
          keyListeners.delete(listener),
      },
    });
  });

  afterEach(() => {
    act(() => renderer?.unmount());
    renderer = null;
    keyListeners.clear();
    jest.restoreAllMocks();
    Object.defineProperty(Platform, 'OS', {
      configurable: true,
      value: originalPlatform,
    });
    if (originalDocument) Object.defineProperty(globalThis, 'document', originalDocument);
    else Reflect.deleteProperty(globalThis, 'document');
  });

  it('consumes Android back and dismisses the active overlay', () => {
    const onDismiss = jest.fn();
    act(() => {
      renderer = create(<DismissHarness active onDismiss={onDismiss} />);
    });

    act(() => expect(backPress({ type: 'hardwareBackPress', timeStamp: 0 })).toBe(true));

    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('consumes Escape and dismisses the active Electron overlay', () => {
    Object.defineProperty(Platform, 'OS', { configurable: true, value: 'web' });
    const onDismiss = jest.fn();
    act(() => {
      renderer = create(<DismissHarness active onDismiss={onDismiss} />);
    });
    const escape = {
      key: 'Escape',
      preventDefault: jest.fn(),
      stopImmediatePropagation: jest.fn(),
    } as unknown as KeyboardEvent;

    act(() => keyListeners.forEach((listener) => listener(escape)));

    expect(onDismiss).toHaveBeenCalledTimes(1);
    expect(escape.preventDefault).toHaveBeenCalledTimes(1);
    expect(escape.stopImmediatePropagation).toHaveBeenCalledTimes(1);
  });

  it('removes listeners after the overlay closes', () => {
    const onDismiss = jest.fn();
    act(() => {
      renderer = create(<DismissHarness active onDismiss={onDismiss} />);
    });

    act(() => {
      renderer?.update(<DismissHarness active={false} onDismiss={onDismiss} />);
    });

    expect(removeBackListener).toHaveBeenCalledTimes(1);
    expect(keyListeners.size).toBe(0);
  });

  it('does not intercept dismissal while inactive or unfocused', () => {
    const onDismiss = jest.fn();
    act(() => {
      renderer = create(<DismissHarness active={false} onDismiss={onDismiss} />);
    });
    expect(BackHandler.addEventListener).not.toHaveBeenCalled();
    expect(keyListeners.size).toBe(0);

    mockFocused = false;
    act(() => {
      renderer?.update(<DismissHarness active onDismiss={onDismiss} />);
    });
    expect(BackHandler.addEventListener).not.toHaveBeenCalled();
    expect(keyListeners.size).toBe(0);
  });
});
