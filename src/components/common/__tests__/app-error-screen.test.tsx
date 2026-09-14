import { act, create, type ReactTestRenderer } from 'react-test-renderer';

import { AppButton } from '../AppButton';
import { AppErrorScreen } from '../AppErrorScreen';

jest.mock('@/stores/theme.store', () => ({
  useThemeStore: (selector: (state: { accent: 'blue'; preference: 'light' }) => unknown) =>
    selector({ accent: 'blue', preference: 'light' }),
}));

describe('AppErrorScreen', () => {
  let renderer: ReactTestRenderer | undefined;
  const onRetry = jest.fn();
  const onHome = jest.fn();
  const onExport = jest.fn();

  afterEach(() => {
    act(() => renderer?.unmount());
    renderer = undefined;
    jest.clearAllMocks();
  });

  function render(repeated: boolean) {
    act(() => {
      renderer = create(
        <AppErrorScreen
          title="Something went wrong"
          message="Your data is safe."
          retryLabel="Try again"
          homeLabel="Return to Chats"
          exportLabel="Export diagnostics"
          repeated={repeated}
          busy={false}
          onRetry={onRetry}
          onHome={onHome}
          onExport={onExport}
        />,
      );
    });
  }

  it('offers retry first for an initial failure', () => {
    render(false);
    const buttons = renderer!.root.findAllByType(AppButton);
    expect(buttons.map((button) => [button.props.label, button.props.variant])).toEqual([
      ['Try again', 'primary'],
      ['Return to Chats', 'secondary'],
      ['Export diagnostics', 'accentText'],
    ]);
    act(() => void buttons[0].props.onPress());
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('offers a safe exit first after a repeated failure', () => {
    render(true);
    const buttons = renderer!.root.findAllByType(AppButton);
    expect(buttons.map((button) => [button.props.label, button.props.variant])).toEqual([
      ['Return to Chats', 'primary'],
      ['Try again', 'secondary'],
      ['Export diagnostics', 'accentText'],
    ]);
    act(() => void buttons[0].props.onPress());
    expect(onHome).toHaveBeenCalledTimes(1);
  });
});
