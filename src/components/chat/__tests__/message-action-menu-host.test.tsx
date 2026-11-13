import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { Modal, Platform, View } from 'react-native';

import { MessageActionMenuHost } from '../message-action-menu-host';

const mockListeners = new Set<() => void>();
jest.mock('react-native-keyboard-controller', () => {
  const { View } = jest.requireActual('react-native') as typeof import('react-native');
  return {
    OverKeyboardView: View,
    KeyboardEvents: {
      addListener: (name: string, callback: () => void) => {
        expect(name).toBe('keyboardWillHide');
        mockListeners.add(callback);
        return { remove: () => mockListeners.delete(callback) };
      },
    },
  };
});

describe('message action menu window ownership', () => {
  const originalOS = Platform.OS;
  let renderer: ReactTestRenderer;

  afterEach(() => {
    act(() => renderer?.unmount());
    Platform.OS = originalOS;
    expect(mockListeners.size).toBe(0);
  });

  it('does not open a focus-taking Android Modal and closes when the keyboard starts hiding', () => {
    Platform.OS = 'android';
    const close = jest.fn();
    act(() => {
      renderer = create(<MessageActionMenuHost active onClose={close}><View /></MessageActionMenuHost>);
    });

    expect(renderer.root.findAllByType(Modal)).toHaveLength(0);
    expect(close).not.toHaveBeenCalled();
    act(() => { mockListeners.forEach(callback => callback()); });
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('keeps its content mounted through exit without reacting to later keyboard events', () => {
    Platform.OS = 'android';
    const close = jest.fn();
    act(() => {
      renderer = create(<MessageActionMenuHost active onClose={close}><View testID="menu" /></MessageActionMenuHost>);
    });
    act(() => {
      renderer.update(<MessageActionMenuHost active={false} onClose={close}><View testID="menu" /></MessageActionMenuHost>);
    });

    expect(renderer.root.findByProps({ testID: 'menu' })).toBeDefined();
    expect(mockListeners.size).toBe(0);
    expect(close).not.toHaveBeenCalled();
  });

  it('retains native modal dismissal on iOS', () => {
    Platform.OS = 'ios';
    const close = jest.fn();
    act(() => {
      renderer = create(<MessageActionMenuHost active onClose={close}><View /></MessageActionMenuHost>);
    });
    act(() => { renderer.root.findByType(Modal).props.onRequestClose(); });
    expect(close).toHaveBeenCalledTimes(1);
    expect(mockListeners.size).toBe(0);
  });
});
