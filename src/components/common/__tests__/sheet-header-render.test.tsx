import { act, create, type ReactTestRenderer } from 'react-test-renderer';

import Check from 'lucide-react-native/icons/check';
import { AppText } from '../AppText';
import { IconButton } from '../IconButton';
import { SheetHeader } from '../SheetHeader';
import { darkPalette, lightPalette, uiDensity } from '@/theme';

let mockPreference: 'light' | 'dark' = 'light';

jest.mock('lucide-react-native/icons/x', () => 'XIcon');
jest.mock('lucide-react-native/icons/check', () => 'CheckIcon');

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => (key === 'common.close' ? 'Close' : key),
    i18n: { language: 'en', resolvedLanguage: 'en' },
  }),
}));

jest.mock('@/stores/theme.store', () => ({
  useThemeStore: (
    selector: (state: { accent: 'blue'; preference: 'light' | 'dark' }) => unknown,
  ) => selector({ accent: 'blue', preference: mockPreference }),
}));

describe('SheetHeader', () => {
  let renderer: ReactTestRenderer | undefined;

  afterEach(() => {
    act(() => renderer?.unmount());
    renderer = undefined;
    mockPreference = 'light';
  });

  it('renders a centered single-line title and a close action', () => {
    const onClose = jest.fn();

    act(() => {
      renderer = create(<SheetHeader title="Message info" onClose={onClose} />);
    });

    const title = renderer!.root.findByType(AppText);
    expect(title.props).toMatchObject({
      align: 'center',
      numberOfLines: 1,
      variant: 'subtitle',
      weight: 'semibold',
      accessibilityRole: 'header',
    });

    const close = renderer!.root.findByType(IconButton);
    expect(close.props.accessibilityLabel).toBe('Close');
    act(() => {
      void close.props.onPress();
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('renders one optional trailing action', () => {
    act(() => {
      renderer = create(
        <SheetHeader
          title="Accounts"
          onClose={() => {}}
          action={
            <IconButton
              accessibilityLabel="Done"
              size={uiDensity.headerActionSize}
              icon={<Check size={uiDensity.headerActionIconSize} />}
            />
          }
        />,
      );
    });

    const buttons = renderer!.root.findAllByType(IconButton);
    expect(buttons).toHaveLength(2);
    expect(buttons[1].props.accessibilityLabel).toBe('Done');
  });

  it.each([
    ['light', lightPalette.text],
    ['dark', darkPalette.text],
  ] as const)('uses the %s theme for header chrome', (preference, textColor) => {
    mockPreference = preference;

    act(() => {
      renderer = create(<SheetHeader title="Accounts" onClose={() => {}} />);
    });

    expect(renderer!.root.findByType(IconButton).props.icon.props.color).toBe(textColor);
  });
});
