import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { BackHandler } from 'react-native';

import {
  ChatComposerPanelBackHandler,
  ChatComposerPanelProvider,
  useChatComposerPanel,
} from '../chat-composer-panel-context';

jest.mock('expo-router', () => ({
  useFocusEffect: (effect: () => void | (() => void)) => {
    const { useEffect } = jest.requireActual('react');
    useEffect(effect, [effect]);
  },
}));

describe('ChatComposerPanelProvider', () => {
  let renderer: ReactTestRenderer | null = null;

  afterEach(() => {
    act(() => renderer?.unmount());
    renderer = null;
    jest.restoreAllMocks();
  });

  it('updates panel consumers without re-rendering an unchanged message subtree', () => {
    let setOpen: ((open: boolean) => void) | null = null;
    let messageRenders = 0;
    let consumerRenders = 0;

    function MessageSubtree() {
      messageRenders += 1;
      return null;
    }

    function PanelConsumer() {
      consumerRenders += 1;
      setOpen = useChatComposerPanel().setOpen;
      return null;
    }

    act(() => {
      renderer = create(
        <ChatComposerPanelProvider>
          <MessageSubtree />
          <PanelConsumer />
        </ChatComposerPanelProvider>,
      );
    });

    expect(messageRenders).toBe(1);
    expect(consumerRenders).toBe(1);

    act(() => setOpen?.(true));

    expect(messageRenders).toBe(1);
    expect(consumerRenders).toBe(2);
  });

  it('consumes Android back to close an open panel, then restores normal back handling', () => {
    let setOpen: ((open: boolean) => void) | null = null;
    let backPress: Parameters<typeof BackHandler.addEventListener>[1] = () => false;
    const remove = jest.fn();
    const addEventListener = jest
      .spyOn(BackHandler, 'addEventListener')
      .mockImplementation((_event, handler) => {
        backPress = handler;
        return { remove };
      });

    function PanelController() {
      setOpen = useChatComposerPanel().setOpen;
      return null;
    }

    act(() => {
      renderer = create(
        <ChatComposerPanelProvider>
          <ChatComposerPanelBackHandler />
          <PanelController />
        </ChatComposerPanelProvider>,
      );
    });
    expect(addEventListener).not.toHaveBeenCalled();

    act(() => setOpen?.(true));
    expect(addEventListener).toHaveBeenCalledWith('hardwareBackPress', expect.any(Function));

    act(() =>
      expect(backPress({ type: 'hardwareBackPress', timeStamp: 0 })).toBe(true),
    );
    expect(remove).toHaveBeenCalledTimes(1);
  });
});
