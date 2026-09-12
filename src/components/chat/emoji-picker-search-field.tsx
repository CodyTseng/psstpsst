import { Magnifer as Search } from '@solar-icons/react-native/category/search/Linear/Magnifer';
import { useTranslation } from 'react-i18next';
import { TextInput, View } from 'react-native';

import { useLanguageDirection } from '@/i18n/direction';
import {
  emojiPickerLayout,
  radius,
  spacing,
  typography,
  uiDensity,
  useThemeColors,
} from '@/theme';

type Props = {
  value: string;
  onChangeText: (text: string) => void;
  content?: 'emoji' | 'sticker';
};

/**
 * The emoji picker's own quiet search field, shared by the Unicode and custom
 * modes: a `surfaceMuted` rounded bar with a leading magnifier. It stays calmer
 * than the global `SearchBar` (no focus ring, no cancel) so it reads as sheet
 * chrome rather than a page search.
 */
export function EmojiPickerSearchField({ value, onChangeText, content = 'emoji' }: Props) {
  const { t } = useTranslation();
  const c = useThemeColors();
  const direction = useLanguageDirection();

  return (
    <View
      style={{
        direction,
        flexDirection: 'row',
        alignItems: 'center',
        gap: spacing.sm,
        height: uiDensity.searchBarHeight,
        marginHorizontal: emojiPickerLayout.horizontalGutter,
        paddingHorizontal: spacing.md,
        borderRadius: radius.lg,
        backgroundColor: c.surfaceMuted,
      }}
    >
      <Search size={18} color={c.textMuted} />
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={t(content === 'sticker' ? 'chat.emoji.search_stickers' : 'chat.emoji.search')}
        placeholderTextColor={c.textMuted}
        autoCorrect={false}
        autoCapitalize="none"
        style={{
          flex: 1,
          color: c.text,
          fontSize: typography.body.fontSize,
          lineHeight: typography.body.fontFamily
            ? typography.body.lineHeight
            : undefined,
          fontFamily: typography.body.fontFamily,
          paddingVertical: 0,
          direction,
          writingDirection: direction,
        }}
      />
    </View>
  );
}
