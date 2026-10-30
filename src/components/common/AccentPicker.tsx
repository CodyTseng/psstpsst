import Check from 'lucide-react-native/icons/check';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';

import { InteractivePressable as Pressable } from '@/components/common/InteractivePressable';
import { useThemeStore } from '@/stores/theme.store';
import { isCustomAccent, resolveAccentPair, type AccentMode, type CustomAccent } from '@/theme/accents';
import { iconStrokeWidth } from '@/theme/icons';
import { ACCENT_KEYS, radius, spacing, uiDensity, useEffectiveColorScheme, useThemeColors } from '@/theme';

import { AppText } from './AppText';
import { ColorPickerSheet } from './ColorPickerSheet';
import { ColorWheelSwatch } from './ColorWheelSwatch';

const SWATCH = uiDensity.accentSwatchSize;
const DOT = uiDensity.accentSwatchDotSize;

/** Swatches show physical light/dark halves independently of the active mode. */
export function AccentPicker() {
  const { t } = useTranslation();
  const c = useThemeColors();
  const scheme = useEffectiveColorScheme();
  const selected = useThemeStore((s) => s.accent);
  const palettes = useThemeStore((s) => s.palettes);
  const setAccent = useThemeStore((s) => s.setAccent);
  const [session, setSession] = useState<{ colors: CustomAccent; mode: AccentMode } | null>(null);
  const [open, setOpen] = useState(false);
  const customSelected = isCustomAccent(selected);
  const selectedPair = resolveAccentPair(selected);
  const swatch = (pair: ReturnType<typeof resolveAccentPair>, isSelected: boolean) => (
    <SplitColorSwatch
      light={pair.light.color}
      dark={pair.dark.color}
      selected={isSelected}
      lightForeground={palettes.light.accentForeground}
      darkForeground={palettes.dark.accentForeground}
    />
  );
  const valueLabel = (pair: ReturnType<typeof resolveAccentPair>) => ({
    text: `${t('appearance.light')}: ${pair.light.color}; ${t('appearance.dark')}: ${pair.dark.color}`,
  });
  const frame = (isSelected: boolean) => ({
    width: SWATCH,
    height: SWATCH,
    borderRadius: radius.full,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    borderWidth: 2,
    borderColor: isSelected ? c.accent : 'transparent',
  });

  return (
    <>
      <View style={{ gap: spacing.sm }}>
        <View style={{
          flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md,
          padding: uiDensity.cardPadding, borderRadius: radius.lg, backgroundColor: c.surfaceElevated,
        }}>
          {ACCENT_KEYS.map((key) => {
            const pair = resolveAccentPair(key);
            const isSelected = key === selected;
            return (
              <Pressable key={key} onPress={() => setAccent(key)} accessibilityRole="button"
                accessibilityState={{ selected: isSelected }} accessibilityLabel={t(`appearance.colors.${key}`)}
                accessibilityValue={valueLabel(pair)} style={frame(isSelected)}>
                {swatch(pair, isSelected)}
              </Pressable>
            );
          })}
          <View style={{ flexDirection: 'row', alignItems: 'center', borderStartWidth: StyleSheet.hairlineWidth,
            borderColor: c.border, paddingStart: spacing.md }}>
            <Pressable accessibilityRole="button" accessibilityLabel={t('appearance.customColor')}
              accessibilityState={{ selected: customSelected }}
              accessibilityValue={customSelected ? valueLabel(selectedPair) : undefined}
              onPress={() => {
                const colors = customSelected && typeof selected === 'object'
                  ? selected
                  : { [scheme]: { color: selectedPair[scheme].color, foreground: selectedPair[scheme].foreground } };
                setSession({ colors, mode: scheme });
                setOpen(true);
              }} style={frame(customSelected)}>
              {customSelected ? swatch(selectedPair, true) : (
                <View style={{ width: DOT, height: DOT, borderRadius: radius.full, overflow: 'hidden' }}>
                  <ColorWheelSwatch />
                </View>
              )}
            </Pressable>
          </View>
        </View>
        <AppText variant="caption" tone="muted">{t('appearance.colorPairHint')}</AppText>
      </View>
      {session != null ? (
        <ColorPickerSheet initialColors={session.colors} initialMode={session.mode} visible={open}
          onApply={(colors) => { setAccent(colors); setOpen(false); }}
          onClose={() => setOpen(false)} onClosed={() => setSession(null)} />
      ) : null}
    </>
  );
}

function SplitColorSwatch({ light, dark, selected, lightForeground, darkForeground }: {
  light: string; dark: string; selected: boolean; lightForeground: string; darkForeground: string;
}) {
  return (
    <View style={{ width: DOT, height: DOT, borderRadius: radius.full, overflow: 'hidden', direction: 'ltr', flexDirection: 'row' }}>
      {[light, dark].map((color, index) => (
        <View key={index} style={{ width: DOT / 2, height: DOT, backgroundColor: color, overflow: 'hidden' }}>
          {selected ? (
            <View style={{ width: DOT, height: DOT, alignItems: 'center', justifyContent: 'center',
              transform: [{ translateX: index === 0 ? 0 : -DOT / 2 }] }}>
              <Check strokeWidth={iconStrokeWidth.default} size={18} color={index === 0 ? lightForeground : darkForeground} />
            </View>
          ) : null}
        </View>
      ))}
    </View>
  );
}
