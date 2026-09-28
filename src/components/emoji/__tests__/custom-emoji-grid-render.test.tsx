import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { FlatList, View } from 'react-native';

import { CustomEmojiGrid } from '../custom-emoji-grid';

jest.mock('@/components/common/AppText', () => ({ AppText: () => null }));
jest.mock('@/components/common/InteractivePressable', () => ({
  InteractivePressable: () => null,
}));
jest.mock('@/components/emoji/CustomEmojiImage', () => ({ CustomEmojiImage: () => null }));
jest.mock('@/i18n/direction', () => ({ useLanguageDirection: () => 'ltr' }));
jest.mock('@/lib/platform', () => ({ IS_ELECTRON: true }));
jest.mock('lucide-react-native/icons/check', () => ({ __esModule: true, default: () => null }));
jest.mock('lucide-react-native/icons/plus', () => ({ __esModule: true, default: () => null }));
jest.mock('@/theme', () => ({
  emojiSize: { composerPickerImage: 68, packImage: 48 },
  radius: { sm: 8, xs: 4 },
  spacing: { lg: 16, xs: 4 },
  typography: { caption: { lineHeight: 18 } },
  useThemeColors: () => ({
    accent: '#000',
    border: '#000',
    interactionOverlay: '#000',
    textMuted: '#000',
  }),
}));

describe('CustomEmojiGrid initial layout', () => {
  let renderer: ReactTestRenderer | null = null;

  afterEach(() => {
    act(() => renderer?.unmount());
    renderer = null;
  });

  it('waits for the container measurement before rendering grid rows', () => {
    const onLayoutResolved = jest.fn();
    const emojis = [
      { shortcode: 'one', url: 'https://example.com/one.png' },
      { shortcode: 'two', url: 'https://example.com/two.png' },
    ];

    act(() => {
      renderer = create(
        <CustomEmojiGrid
          emojis={emojis}
          emptyComponent={<View testID="empty" />}
          horizontalPadding={8}
          onLayoutResolved={onLayoutResolved}
        />,
      );
    });

    expect(renderer!.root.findByType(FlatList).props.data).toEqual([]);
    expect(renderer!.root.findByType(FlatList).props.ListEmptyComponent).toBeNull();
    expect(onLayoutResolved).not.toHaveBeenCalled();

    act(() => {
      renderer!.root.findByType(FlatList).props.onLayout({
        nativeEvent: { layout: { width: 400 } },
      });
    });

    expect(renderer!.root.findByType(FlatList).props.data).toHaveLength(1);
    expect(onLayoutResolved).toHaveBeenCalledWith(expect.objectContaining({ columns: 5 }));
  });
});
