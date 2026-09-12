import Check from 'lucide-react-native/icons/check';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { InteractivePressable as Pressable } from '@/components/common/InteractivePressable';

import { useThemeStore } from '@/stores/theme.store';
import { iconStrokeWidth } from '@/theme/icons';
import {
  ACCENT_KEYS,
  ACCENTS,
  radius,
  spacing,
  uiDensity,
  useEffectiveColorScheme,
  useThemeColors,
} from '@/theme';

// A swatch is a filled circle; when selected it carries a same-hue ring with a
// gap (the wrapper's transparent border over the panel) plus a white check.
const SWATCH = uiDensity.accentSwatchSize;
const DOT = uiDensity.accentSwatchDotSize;

/**
 * The accent (brand) colour picker (DESIGN §8): a wrap-row of colour
 * swatches inside one `surfaceElevated` panel matching the `ListGroup` cards.
 * Each swatch shows its colour in the *current* light/dark mode; tapping one
 * sets the accent app-wide instantly (`theme.store`). The single place this
 * control is drawn — don't hand-roll colour dots elsewhere.
 */
export function AccentPicker() {
  const { t } = useTranslation();
  const c = useThemeColors();
  const scheme = useEffectiveColorScheme();
  const selected = useThemeStore((s) => s.accent);
  const setAccent = useThemeStore((s) => s.setAccent);

  return (
    <View
      style={{
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: spacing.md,
        padding: uiDensity.cardPadding,
        borderRadius: radius.lg,
        backgroundColor: c.surfaceElevated,
      }}
    >
      {ACCENT_KEYS.map((key) => {
        const color = ACCENTS[key][scheme].accent;
        const isSelected = key === selected;
        return (
          <Pressable
            key={key}
            onPress={() => setAccent(key)}
            accessibilityRole="button"
            accessibilityState={{ selected: isSelected }}
            accessibilityLabel={t(`appearance.colors.${key}`)}
            style={{
              width: SWATCH,
              height: SWATCH,
              borderRadius: radius.full,
              alignItems: 'center',
              justifyContent: 'center',
              borderWidth: 2,
              borderColor: isSelected ? color : 'transparent',
            }}
          >
            <View
              style={{
                width: DOT,
                height: DOT,
                borderRadius: radius.full,
                backgroundColor: color,
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              {isSelected ? (
                <Check strokeWidth={iconStrokeWidth.default} size={18} color={c.accentForeground} />
              ) : null}
            </View>
          </Pressable>
        );
      })}
    </View>
  );
}
