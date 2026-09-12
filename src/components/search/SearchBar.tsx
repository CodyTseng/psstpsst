import { Magnifer as Search } from '@solar-icons/react-native/category/search/Linear/Magnifer';
import X from 'lucide-react-native/icons/x';
import { forwardRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, TextInput, View } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';

import { InteractivePressable as Pressable } from '@/components/common/InteractivePressable';

import { resolveSearchPlaceholder } from '@/components/search/search-shortcut';
import { SEARCH_ACTIVATION_TRANSITION_MS } from '@/components/search/SearchTransition';
import { iconStrokeWidth } from '@/theme/icons';
import { radius, spacing, typography, uiDensity, useThemeColors } from '@/theme';

// The rounded field shell needs a slightly tighter screen gutter than square
// list content to appear optically aligned with the page edge.
export const SEARCH_BAR_SCREEN_GUTTER = spacing.md;

type Props = {
  value: string;
  onChangeText: (text: string) => void;
  placeholder?: string;
  autoFocus?: boolean;
  onFocus?: () => void;
  onBlur?: () => void;
  shortcutHint?: string;
  /** Button mode: keep the input shell non-editable beneath a tap target, so it
   * can sit in a list header and only opens editable search on tap — the iOS
   * "inactive search bar" affordance. */
  onPress?: () => void;
};

/**
 * The shared search field — a calm `surfaceMuted` rounded pill with a leading
 * magnifier and a trailing clear (×). Used by the Chats tab, the Contacts tab,
 * and the in-conversation search screen.
 * Keep volatile `value` state in the *parent* so a keystroke doesn't re-render a
 * sibling list (ARCHITECTURE §7). With `onPress` the same input shell becomes
 * an inactive button that opens editable search on tap.
 */
export const SearchBar = forwardRef<TextInput, Props>(function SearchBar(
  {
    value,
    onChangeText,
    placeholder,
    autoFocus,
    onFocus,
    onBlur,
    shortcutHint,
    onPress,
  },
  ref,
) {
  const { t } = useTranslation();
  const c = useThemeColors();
  const [focused, setFocused] = useState(false);
  const basePlaceholder = placeholder ?? t('search.placeholder');
  const resolvedPlaceholder = resolveSearchPlaceholder(
    basePlaceholder,
    shortcutHint,
    focused,
  );

  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
      <View
        style={{
          flex: 1,
          flexDirection: 'row',
          alignItems: 'center',
          gap: 8,
          height: uiDensity.searchBarHeight,
          paddingHorizontal: 10,
          borderWidth: 1,
          borderColor: 'transparent',
          borderRadius: radius.md,
          backgroundColor: c.surfaceMuted,
        }}
      >
        {focused ? (
          <Animated.View
            pointerEvents="none"
            entering={FadeIn.duration(SEARCH_ACTIVATION_TRANSITION_MS)}
            style={[
              StyleSheet.absoluteFill,
              {
                borderWidth: 1,
                borderColor: c.accent,
                borderRadius: radius.md,
              },
            ]}
          />
        ) : null}
        <Search size={18} color={c.textMuted} />
        <TextInput
          ref={ref}
          value={value}
          onChangeText={onChangeText}
          placeholder={resolvedPlaceholder}
          placeholderTextColor={c.textMuted}
          editable={!onPress}
          pointerEvents={onPress ? 'none' : 'auto'}
          accessible={!onPress}
          autoFocus={autoFocus}
          onFocus={() => {
            setFocused(true);
            onFocus?.();
          }}
          onBlur={() => {
            setFocused(false);
            onBlur?.();
          }}
          autoCorrect={false}
          autoCapitalize="none"
          returnKeyType="search"
          style={{
            flex: 1,
            color: c.text,
            fontSize: typography.body.fontSize,
            lineHeight: typography.body.fontFamily ? typography.body.lineHeight : undefined,
            fontFamily: typography.body.fontFamily,
            paddingVertical: 0,
          }}
        />
        {value.length > 0 ? (
          <Pressable onPress={() => onChangeText('')} hitSlop={8}>
            <X strokeWidth={iconStrokeWidth.default} size={16} color={c.textMuted} />
          </Pressable>
        ) : null}
        {onPress ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={resolvedPlaceholder}
            onPress={onPress}
            hoverFeedback={false}
            fallbackHoverOpacity={false}
            pressFeedback="none"
            style={StyleSheet.absoluteFill}
          />
        ) : null}
      </View>
    </View>
  );
});
