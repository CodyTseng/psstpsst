import { act, create, type ReactTestRenderer } from 'react-test-renderer';

import {
  ChatComposerPanelProvider,
  useChatComposerPanel,
} from '../chat-composer-panel-context';

describe('ChatComposerPanelProvider', () => {
  let renderer: ReactTestRenderer | null = null;

  afterEach(() => {
    act(() => renderer?.unmount());
    renderer = null;
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
});
