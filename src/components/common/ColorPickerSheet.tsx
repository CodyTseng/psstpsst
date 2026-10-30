import Check from 'lucide-react-native/icons/check';
import { useCallback, useId, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Platform, StyleSheet, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { useAnimatedProps, useAnimatedStyle, useSharedValue, type SharedValue } from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';
import Svg, { Defs, G, LinearGradient, Mask, Rect, Stop } from 'react-native-svg';

import { clampUnit, colorAtPosition, hexToHsv, hsvToHex, type HSV } from '@/lib/color-picker';
import { accentForegroundTones, customAccentTones, defaultAccentForeground, normalizeCustomAccent, parseAccent, resolveAccentPair, type AccentMode, type AccentForeground, type CustomAccent } from '@/theme/accents';
import { radius, spacing, ThemeColorsContext, uiDensity, useThemeColors } from '@/theme';
import { colorPickerColors, colorPickerLayout } from '@/theme/color-picker';
import { iconStrokeWidth } from '@/theme/icons';
import { defaultThemePalettes } from '@/theme/palette';
import { EffectiveColorSchemeContext } from '@/theme/effective-color-scheme';

import { MessageAppearancePreview } from '@/components/chat/MessageAppearancePreview';
import { AppButton } from './AppButton';
import { AppText } from './AppText';
import { SegmentedControl } from './SegmentedControl';
import { AppInput } from './AppInput';
import { BottomSheet } from './BottomSheet';
import { ColorSpectrum } from './ColorSpectrum';
import { IconButton } from './IconButton';
import { useSheetBodyGestures } from './sheet-body-gestures';

const AnimatedSvg = Animated.createAnimatedComponent(Svg);

type Props = {
  visible: boolean;
  initialColors: CustomAccent;
  initialMode: AccentMode;
  autoForeground?: boolean;
  onApply: (colors: CustomAccent) => void;
  onClose: () => void;
  onClosed: () => void;
};

type DraftMode = { color: string; foreground: AccentForeground };
type Drafts = Partial<Record<AccentMode, DraftMode>>;

/** Both modes remain a local draft until Done; an untouched mode follows its peer. */
export function ColorPickerSheet({ visible, initialColors, initialMode, autoForeground = false, onApply, onClose, onClosed }: Props) {
  const { t } = useTranslation();
  const [fallback] = useState(() => resolveAccentPair(initialColors));
  const [mode, setMode] = useState(initialMode);
  const [drafts, setDrafts] = useState<Drafts>(initialColors);
  const manualForeground = useRef({ light: !autoForeground, dark: !autoForeground });
  const other = mode === 'light' ? 'dark' : 'light';
  const current = drafts[mode] ?? drafts[other] ?? fallback[mode];
  const hsv = useSharedValue(hexToHsv(fallback[initialMode].color));
  const [value, setValue] = useState(() => hexToHsv(fallback[initialMode].color));
  const [touched, setTouched] = useState(false);
  const foregroundColors = useMemo(() => accentForegroundTones(current.foreground), [current.foreground]);
  const normalized = normalizeCustomAccent(current.color);
  const previewColor = normalized ?? hsvToHex(value);
  const c = useMemo(() => ({
    ...defaultThemePalettes[mode],
    ...customAccentTones(previewColor, defaultThemePalettes[mode].background, current.foreground),
  }), [mode, previewColor, current.foreground]);
  const parsed = parseAccent(drafts);
  const canApply = parsed != null && typeof parsed === 'object';
  const updateFromControl = useCallback((next: HSV) => {
    setValue(next);
    setDrafts((previous) => {
      const existing = previous[mode] ?? previous[mode === 'light' ? 'dark' : 'light'] ?? fallback[mode];
      const color = hsvToHex(next);
      return { ...previous, [mode]: { color,
        foreground: manualForeground.current[mode] ? existing.foreground : defaultAccentForeground(color) } };
    });
    setTouched(false);
  }, [fallback, mode]);
  const previewStyle = useAnimatedStyle(() => ({ backgroundColor: hsvToHex(hsv.get()) }));
  const apply = () => {
    if (parsed && typeof parsed === 'object') onApply(parsed);
  };
  const switchMode = (nextMode: AccentMode) => {
    if (mode === nextMode) return;
    const next = drafts[nextMode] ?? drafts[nextMode === 'light' ? 'dark' : 'light'] ?? fallback[nextMode];
    const nextHsv = hexToHsv(normalizeCustomAccent(next.color) ?? fallback[nextMode].color);
    hsv.set(nextHsv);
    setValue(nextHsv);
    setTouched(false);
    setMode(nextMode);
  };

  return (
    <EffectiveColorSchemeContext.Provider value={mode}>
    <ThemeColorsContext.Provider value={c}>
    <BottomSheet
      visible={visible}
      onClose={onClose}
      onClosed={onClosed}
      title={t('appearance.customColor')}
      fixedSubheader={
        <MessageAppearancePreview colors={foregroundColors} backgroundStyle={previewStyle} />
      }
      headerAction={
        <IconButton
          variant="accent"
          size={uiDensity.headerActionSize}
          disabled={!canApply}
          accessibilityLabel={t('common.done')}
          onPress={apply}
          icon={<Check strokeWidth={iconStrokeWidth.default} size={uiDensity.headerActionIconSize} color={canApply ? c.accentForeground : c.textMuted} />}
        />
      }
    >
      <SegmentedControl value={mode} onChange={switchMode} options={[
        { value: 'light', label: t('appearance.light') },
        { value: 'dark', label: t('appearance.dark') },
      ]} />
      <View style={{ gap: spacing.sm }}>
        <View style={{ flexDirection: 'row', gap: spacing.md,
          aspectRatio: colorPickerLayout.areaAspectRatio, maxHeight: colorPickerLayout.areaMaxHeight }}>
          <ColorControl value={value} hsv={hsv} onChange={updateFromControl} />
          <ColorControl value={value} hsv={hsv} onChange={updateFromControl} hueOnly />
        </View>
        <AppInput
          label={t('appearance.hexColor')}
          accessibilityLabel={`${t(`appearance.${mode}`)} ${t('appearance.hexColor')}`}
          error={touched && !normalized ? t('appearance.invalidColor') : undefined}
          value={current.color}
          onChangeText={(value) => {
            const normalized = normalizeCustomAccent(value);
            setDrafts((previous) => ({ ...previous, [mode]: { color: value,
              foreground: normalized && !manualForeground.current[mode] ? defaultAccentForeground(normalized) : current.foreground } }));
            setTouched(false);
            const color = normalizeCustomAccent(value);
            if (color) {
              const next = hexToHsv(color, hsv.get().h);
              hsv.set(next);
              setValue(next);
            }
          }}
          onBlur={() => setTouched(true)}
          autoCapitalize="characters"
          autoCorrect={false}
          spellCheck={false}
          style={{ writingDirection: 'ltr' }}
          returnKeyType="done"
          onSubmitEditing={apply}
        />
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
        gap: spacing.md, flexWrap: 'wrap' }}>
        <AppText variant="caption" tone="muted">{t('appearance.foreground')}</AppText>
        <View accessibilityRole="radiogroup" accessibilityLabel={t('appearance.foreground')}
          style={{ flexDirection: 'row', gap: spacing.lg }}>
          {(['white', 'black'] as const).map((foreground) => {
            const selected = current.foreground === foreground;
            const swatchColor = foreground === 'white' ? colorPickerColors.white : colorPickerColors.black;
            const checkColor = foreground === 'white' ? colorPickerColors.black : colorPickerColors.white;
            return (
              <AppButton key={foreground} variant="text" compact compactAxis="none"
                accessibilityRole="radio" accessibilityState={{ checked: selected }} aria-checked={selected}
                accessibilityLabel={t(`appearance.${foreground}Foreground`)}
                label={t(`appearance.${foreground}Foreground`)} labelWeight="medium"
                onPress={() => {
                  manualForeground.current[mode] = true;
                  setDrafts((previous) => ({ ...previous, [mode]: { ...current, foreground } }));
                }}
                iconLeft={
                  <View style={{ width: colorPickerLayout.foregroundSwatchSize, height: colorPickerLayout.foregroundSwatchSize,
                    borderRadius: radius.full, borderWidth: StyleSheet.hairlineWidth, borderColor: c.border,
                    backgroundColor: swatchColor, alignItems: 'center', justifyContent: 'center' }}>
                    {selected ? <Check strokeWidth={iconStrokeWidth.compact} size={colorPickerLayout.foregroundCheckSize} color={checkColor} /> : null}
                  </View>
                }
              />
            );
          })}
        </View>
      </View>
    </BottomSheet>
    </ThemeColorsContext.Provider>
    </EffectiveColorSchemeContext.Provider>
  );
}

function ColorControl({ value, hsv, onChange, hueOnly = false }: {
  value: HSV;
  hsv: SharedValue<HSV>;
  onChange: (color: HSV) => void;
  hueOnly?: boolean;
}) {
  const { t } = useTranslation();
  const c = useThemeColors();
  const id = useId();
  const sheetGestures = useSheetBodyGestures();
  const width = useSharedValue(0);
  const height = useSharedValue(0);
  const [focused, setFocused] = useState(false);
  const gesture = useMemo(() => {
    const move = (event: { x: number; y: number }) => {
      'worklet';
      const next = colorAtPosition(hsv.get(), hueOnly, event.x, event.y, width.get(), height.get(), hueOnly);
      hsv.set(next);
      scheduleOnRN(onChange, next);
    };
    // Activate at touch-down so vertical selection cannot become sheet dismissal.
    const pan = Gesture.Pan().minDistance(0).maxPointers(1)
      .shouldCancelWhenOutside(false).onStart(move).onUpdate(move);
    const tap = Gesture.Tap().onEnd((event, success) => {
      if (success) move(event);
    });
    if (sheetGestures) {
      pan.blocksExternalGesture(...sheetGestures);
      tap.blocksExternalGesture(...sheetGestures);
    }
    return Gesture.Race(pan, tap);
  }, [height, hsv, hueOnly, onChange, sheetGestures, width]);
  const backgroundProps = useAnimatedProps(() => ({
    color: hsvToHex({ h: hsv.get().h, s: 1, v: 1 }),
  }));
  const thumbStyle = useAnimatedStyle(() => {
    const current = hsv.get();
    const size = colorPickerLayout.thumbSize;
    const x = hueOnly ? width.get() / 2 : current.s * width.get();
    const y = (hueOnly ? current.h / 360 : 1 - current.v) * height.get();
    return {
      backgroundColor: hsvToHex(hueOnly ? { h: current.h, s: 1, v: 1 } : current),
      transform: [
        { translateX: Math.max(0, Math.min(width.get() - size, x - size / 2)) },
        { translateY: Math.max(0, Math.min(height.get() - size, y - size / 2)) },
      ],
    };
  });
  const adjust = (action: string) => {
    const current = hsv.get();
    const next = hueOnly
      ? { ...current, h: Math.max(0, Math.min(360, current.h + (action === 'decrement' ? -3 : 3))) }
      : action === 'increaseSaturation' || action === 'decreaseSaturation'
        ? { ...current, s: clampUnit(current.s + (action === 'decreaseSaturation' ? -0.01 : 0.01)) }
        : { ...current, v: clampUnit(current.v + (action === 'decrement' ? -0.01 : 0.01)) };
    hsv.set(next);
    onChange(next);
  };
  const webProps = Platform.OS === 'web' ? {
    tabIndex: 0 as const,
    'aria-orientation': hueOnly ? 'vertical' as const : undefined,
    onFocus: (event: { currentTarget: unknown }) => {
      const target = event.currentTarget as { matches?: (selector: string) => boolean };
      setFocused(target.matches?.(':focus-visible') ?? false);
    },
    onBlur: () => setFocused(false),
    onPointerDown: () => setFocused(false),
    onKeyDown: (event: { key: string; preventDefault: () => void }) => {
      setFocused(true);
      const action = hueOnly
        ? { ArrowLeft: 'decrement', ArrowUp: 'decrement', ArrowRight: 'increment', ArrowDown: 'increment' }[event.key]
        : { ArrowLeft: 'decreaseSaturation', ArrowRight: 'increaseSaturation', ArrowDown: 'decrement', ArrowUp: 'increment' }[event.key];
      if (action) { event.preventDefault(); adjust(action); }
    },
  } : {};

  return (
    <GestureDetector gesture={gesture} touchAction="none">
      <View
        {...webProps}
        accessible
        accessibilityRole="adjustable"
        accessibilityLabel={t(hueOnly ? 'appearance.hue' : 'appearance.colorArea')}
        accessibilityValue={hueOnly
          ? { min: 0, max: 360, now: Math.round(value.h) }
          : { text: `${t('appearance.saturation')} ${Math.round(value.s * 100)}%, ${t('appearance.brightness')} ${Math.round(value.v * 100)}%` }}
        accessibilityActions={[
          { name: 'increment' }, { name: 'decrement' },
          ...(!hueOnly ? [
            { name: 'increaseSaturation', label: `${t('appearance.saturation')} +` },
            { name: 'decreaseSaturation', label: `${t('appearance.saturation')} −` },
          ] : []),
        ]}
        onAccessibilityAction={(event) => adjust(event.nativeEvent.actionName)}
        onLayout={(event) => {
          width.set(event.nativeEvent.layout.width);
          height.set(event.nativeEvent.layout.height);
        }}
        style={{
          direction: 'ltr',
          flex: hueOnly ? undefined : 1,
          width: hueOnly ? colorPickerLayout.hueControlWidth : undefined,
          height: '100%',
          alignItems: 'center',
          borderRadius: radius.md,
          outlineWidth: 0,
          justifyContent: 'center',
        }}
      >
        <Animated.View style={[
          hueOnly ? { width: colorPickerLayout.trackThickness, height: '100%' } : StyleSheet.absoluteFill,
          { borderRadius: hueOnly ? radius.full : 0, overflow: hueOnly ? 'hidden' : 'visible', pointerEvents: 'none' },
        ]}>
          {hueOnly ? <ColorSpectrum vertical /> : (
            <AnimatedSvg width="100%" height="100%" animatedProps={backgroundProps}>
              <Defs>
                <Mask id={`${id}-rounded`} x="0" y="0" width="100%" height="100%" maskUnits="userSpaceOnUse">
                  <Rect width="100%" height="100%" rx={radius.md} ry={radius.md} fill={colorPickerColors.white} />
                </Mask>
                <LinearGradient id={`${id}-saturation`} x1="0%" y1="0%" x2="100%" y2="0%">
                  <Stop offset="0" stopColor={colorPickerColors.white} />
                  <Stop offset="1" stopColor={colorPickerColors.transparentWhite} />
                </LinearGradient>
                <LinearGradient id={`${id}-value`} x1="0%" y1="0%" x2="0%" y2="100%">
                  <Stop offset="0" stopColor={colorPickerColors.transparentBlack} />
                  <Stop offset="1" stopColor={colorPickerColors.black} />
                </LinearGradient>
              </Defs>
              {/* Composite the opaque field first, then mask it once to prevent corner halos. */}
              <G mask={`url(#${id}-rounded)`}>
                <Rect width="100%" height="100%" fill="currentColor" />
                <Rect width="100%" height="100%" fill={`url(#${id}-saturation)`} />
                <Rect width="100%" height="100%" fill={`url(#${id}-value)`} />
              </G>
            </AnimatedSvg>
          )}
        </Animated.View>
        <Animated.View style={[{
          position: 'absolute',
          start: 0,
          top: 0,
          width: colorPickerLayout.thumbSize,
          height: colorPickerLayout.thumbSize,
          borderRadius: radius.full,
          borderWidth: colorPickerLayout.thumbBorder,
          borderColor: colorPickerColors.white,
          boxShadow: focused
            ? `0px 0px 0px 2px ${c.accent}`
            : `0px 0px 0px 1px ${colorPickerColors.black}`,
          pointerEvents: 'none',
        }, thumbStyle]} />
      </View>
    </GestureDetector>
  );
}
