import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { BackHandler } from 'react-native';

import { ChatSelectionCancelHandler } from '../chat-selection-cancel-handler';

let mockFocused = true;

jest.mock('expo-router', () => ({
  useFocusEffect: (effect: () => void | (() => void)) => {
    const { useEffect } = jest.requireActual('react');
    const focused = mockFocused;
    useEffect(() => (focused ? effect() : undefined), [effect, focused]);
  },
}));

describe('ChatSelectionCancelHandler', () => {
  let renderer: ReactTestRenderer | null = null;
  let backPress: Parameters<typeof BackHandler.addEventListener>[1] = () => false;
  const removeBackListener = jest.fn();
  const keyListeners = new Set<(event: KeyboardEvent) => void>();
  const originalDocument = Object.getOwnPropertyDescriptor(globalThis, 'document');

  beforeEach(() => {
    mockFocused = true;
    jest.clearAllMocks();
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
    if (originalDocument) Object.defineProperty(globalThis, 'document', originalDocument);
    else Reflect.deleteProperty(globalThis, 'document');
  });

  it('consumes Android back and Escape while selection is active', () => {
    const onCancel = jest.fn();
    act(() => {
      renderer = create(<ChatSelectionCancelHandler active onCancel={onCancel} />);
    });

    act(() => expect(backPress({ type: 'hardwareBackPress', timeStamp: 0 })).toBe(true));
    const escape = { key: 'Escape', preventDefault: jest.fn() } as unknown as KeyboardEvent;
    act(() => keyListeners.forEach((listener) => listener(escape)));

    expect(onCancel).toHaveBeenCalledTimes(2);
    expect(escape.preventDefault).toHaveBeenCalledTimes(1);
  });

  it('does not intercept keys or back outside active selection on a focused chat', () => {
    const onCancel = jest.fn();
    act(() => {
      renderer = create(<ChatSelectionCancelHandler active={false} onCancel={onCancel} />);
    });

    expect(BackHandler.addEventListener).not.toHaveBeenCalled();
    expect(keyListeners.size).toBe(0);

    act(() => {
      renderer?.update(<ChatSelectionCancelHandler active onCancel={onCancel} />);
    });
    const enter = { key: 'Enter', preventDefault: jest.fn() } as unknown as KeyboardEvent;
    act(() => keyListeners.forEach((listener) => listener(enter)));
    expect(onCancel).not.toHaveBeenCalled();
    expect(enter.preventDefault).not.toHaveBeenCalled();

    mockFocused = false;
    act(() => {
      renderer?.update(<ChatSelectionCancelHandler active onCancel={onCancel} />);
    });
    expect(removeBackListener).toHaveBeenCalledTimes(1);
    expect(keyListeners.size).toBe(0);
  });
});
