import { router } from 'expo-router';
import { SafeAreaInsetsContext } from 'react-native-safe-area-context';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';

import { AppButton } from '../AppButton';
import { ScreenHeader } from '../ScreenHeader';

jest.mock('expo-router', () => ({
  router: { canGoBack: jest.fn(), back: jest.fn() },
}));
jest.mock('lucide-react-native/icons/chevron-left', () => () => null, { virtual: true });
jest.mock('@/components/common/ChromeBackdrop', () => ({ ChromeBackdrop: () => null }));
jest.mock('@/stores/theme.store', () => ({
  useThemeStore: (selector: (state: { accent: 'blue'; preference: 'light' }) => unknown) =>
    selector({ accent: 'blue', preference: 'light' }),
}));
jest.mock('@/i18n/direction', () => ({
  useDirectionalIconStyle: () => undefined,
}));

describe('ScreenHeader back navigation', () => {
  let renderer: ReactTestRenderer | undefined;

  beforeEach(() => {
    jest.resetAllMocks();
    jest.mocked(router.canGoBack).mockReturnValue(true);
  });

  afterEach(() => {
    act(() => renderer?.unmount());
    renderer = undefined;
  });

  function render(onBack?: () => void): () => void {
    act(() => {
      renderer = create(
        <SafeAreaInsetsContext.Provider value={{ top: 0, bottom: 0, left: 0, right: 0 }}>
          <ScreenHeader onBack={onBack} />
        </SafeAreaInsetsContext.Provider>,
      );
    });
    return renderer!.root.findByType(AppButton).props.onPress;
  }

  it('returns normally when a back destination exists', () => {
    const press = render();
    act(press);
    expect(router.back).toHaveBeenCalledTimes(1);
  });

  it('ignores a queued press after the session gate unmounts navigation', () => {
    const queuedPress = render();
    act(() => renderer!.unmount());
    renderer = undefined;
    jest.mocked(router.canGoBack).mockReturnValue(false);
    jest.mocked(router.back).mockImplementationOnce(() => {
      throw new Error('Attempted to navigate before mounting the Root Layout component.');
    });

    expect(() => act(queuedPress)).not.toThrow();
    expect(router.back).not.toHaveBeenCalled();
  });

  it('checks again when another press has already returned to the root', () => {
    const press = render();
    act(press);
    jest.mocked(router.canGoBack).mockReturnValue(false);
    act(press);
    expect(router.back).toHaveBeenCalledTimes(1);
  });

  it('keeps custom back actions available without a navigation stack', () => {
    jest.mocked(router.canGoBack).mockReturnValue(false);
    const onBack = jest.fn();
    const press = render(onBack);
    act(press);
    expect(onBack).toHaveBeenCalledTimes(1);
    expect(router.canGoBack).not.toHaveBeenCalled();
    expect(router.back).not.toHaveBeenCalled();
  });
});
