import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { View } from 'react-native';

import { IconButton } from '@/components/common/IconButton';
import { spacing, uiDensity } from '@/theme';

import { MediaViewerTopBar } from '../MediaViewerTopBar';

jest.mock('@/components/common/ZoomableImage', () => ({ IMAGE_MAX_SCALE: 4 }));
jest.mock('lucide-react-native/icons/minus', () => ({ __esModule: true, default: () => null }), { virtual: true });
jest.mock('lucide-react-native/icons/plus', () => ({ __esModule: true, default: () => null }), { virtual: true });

jest.mock(
  '@solar-icons/react-native/category/arrows-action/Linear/DownloadMinimalistic',
  () => ({ DownloadMinimalistic: () => null }),
  { virtual: true },
);

jest.mock(
  'lucide-react-native/icons/x',
  () => ({ __esModule: true, default: () => null }),
  { virtual: true },
);

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => ({ 'common.close': 'Close', 'attach.save': 'Save' })[key] ?? key,
  }),
}));

jest.mock('@/stores/theme.store', () => ({
  useThemeStore: (selector: (state: { accent: 'blue' }) => unknown) =>
    selector({ accent: 'blue' }),
}));

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 12, right: 0, bottom: 0, left: 0 }),
}));

describe('MediaViewerTopBar', () => {
  let renderer: ReactTestRenderer | undefined;

  afterEach(() => {
    act(() => renderer?.unmount());
    renderer = undefined;
  });

  it('uses the title-bar rail and places close before save', () => {
    act(() => {
      renderer = create(
        <MediaViewerTopBar onClose={jest.fn()} onSave={jest.fn()} />,
      );
    });

    const bar = renderer!.root.findAllByType(View)[0];
    expect(bar.props.style).toEqual(
      expect.objectContaining({
        top: 12 + spacing.sm,
        start: 0,
        end: 0,
        paddingHorizontal: spacing.sm,
      }),
    );

    const buttons = renderer!.root.findAllByType(IconButton);
    expect(buttons).toHaveLength(2);
    expect(buttons.map((button) => button.props.accessibilityLabel)).toEqual(['Close', 'Save']);
    expect(buttons.every((button) => button.props.variant === 'overlay')).toBe(true);
    expect(buttons.every((button) => button.props.size === uiDensity.headerActionSize)).toBe(true);
  });

  it('adds one context action between close and save', () => {
    act(() => {
      renderer = create(
        <MediaViewerTopBar
          onClose={jest.fn()}
          onSave={jest.fn()}
          extraAction={{ accessibilityLabel: 'Show all', icon: <View />, onPress: jest.fn() }}
        />,
      );
    });

    const buttons = renderer!.root.findAllByType(IconButton);
    expect(buttons.map((button) => button.props.accessibilityLabel)).toEqual([
      'Close',
      'Show all',
      'Save',
    ]);
  });
});
