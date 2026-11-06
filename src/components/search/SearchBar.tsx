import Search from 'lucide-react-native/icons/search';
import { forwardRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, TextInput } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';

import { InteractivePressable as Pressable } from '@/components/common/InteractivePressable';
import { InputClearButton } from '@/components/common/InputClearButton';
import { SearchRowLayout } from '@/components/common/SearchRowLayout';
import { resolveSearchPlaceholder } from '@/components/search/search-shortcut';
import { SEARCH_ACTIVATION_TRANSITION_MS } from '@/components/search/SearchTransition';
import { iconStrokeWidth, radius, searchFieldLayout, spacing, typography, useThemeColors } from '@/theme';

export const SEARCH_BAR_SCREEN_GUTTER = spacing.md;

type Props = {
  value: string;
  onChangeText: (text: string) => void;
  placeholder?: string;
  autoFocus?: boolean;
  onFocus?: () => void;
  onBlur?: () => void;
  onSubmitEditing?: () => void;
  shortcutHint?: string;
  /** Resting button mode retains the same field geometry as editable search. */
  onPress?: () => void;
};

export const SearchBar = forwardRef<TextInput, Props>(function SearchBar({
  value, onChangeText, placeholder, autoFocus, onFocus, onBlur, onSubmitEditing, shortcutHint, onPress,
}, ref) {
  const { t } = useTranslation();
  const c = useThemeColors();
  const [focused, setFocused] = useState(false);
  const resolvedPlaceholder = resolveSearchPlaceholder(placeholder ?? t('search.placeholder'), shortcutHint, focused);

  return <SearchRowLayout filled
    icon={<Search size={searchFieldLayout.iconSize} strokeWidth={iconStrokeWidth.default} color={c.textMuted} />}
    action={value.length > 0 ? <InputClearButton onPress={() => onChangeText('')} /> : undefined}
    overlay={<>
      {focused ? <Animated.View entering={FadeIn.duration(SEARCH_ACTIVATION_TRANSITION_MS)}
        style={[StyleSheet.absoluteFill, {
          borderWidth: searchFieldLayout.borderWidth, borderColor: c.accent, borderRadius: radius.md,
          pointerEvents: 'none',
        }]} /> : null}
      {onPress ? <Pressable accessibilityRole="button" accessibilityLabel={resolvedPlaceholder}
        onPress={onPress} hoverFeedback={false} fallbackHoverOpacity={false} pressFeedback="none"
        style={[StyleSheet.absoluteFill, { zIndex: 1 }]} /> : null}
    </>}>
    <TextInput ref={ref} value={value} onChangeText={onChangeText}
      placeholder={resolvedPlaceholder} placeholderTextColor={c.textMuted}
      editable={!onPress} accessible={!onPress} autoFocus={autoFocus}
      onFocus={() => { setFocused(true); onFocus?.(); }}
      onBlur={() => { setFocused(false); onBlur?.(); }}
      autoCorrect={false} autoCapitalize="none" returnKeyType="search" onSubmitEditing={onSubmitEditing}
      style={{
        width: '100%', minWidth: 0, padding: 0, color: c.text,
        fontSize: typography.body.fontSize,
        lineHeight: typography.body.fontFamily ? typography.body.lineHeight : undefined,
        fontFamily: typography.body.fontFamily, pointerEvents: onPress ? 'none' : 'auto',
      }} />
  </SearchRowLayout>;
});
