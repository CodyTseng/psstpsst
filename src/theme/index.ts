import { spacing } from './spacing';
import { createContext, useContext } from 'react';
import { Platform, type TextStyle } from 'react-native';

import { IS_ELECTRON } from '@/lib/platform';
import { useThemeStore } from '@/stores/theme.store';

import { ACCENTS, ACCENT_KEYS, type AccentKey, type AccentSelection } from './accents';
import { defaultThemePalettes, type ThemeColors } from './palette';
import { useEffectiveColorScheme } from './effective-color-scheme';
import { density } from './layout';

export { darkPalette, lightPalette } from './palette';
export type { ThemeColors } from './palette';
export {
  SystemColorSchemeProvider,
  useEffectiveColorScheme,
} from './effective-color-scheme';
export {
  bottomChrome,
  contentWidth,
  density,
  desktopChrome,
  mediaGrid,
  wideLayout,
} from './layout';
export { fontWeight, typography } from './typography';
export { iconStrokeWidth } from './icons';
export type { FontWeight, TextVariant } from './typography';

// The accent palette (`AccentKey`, `ACCENTS`, `ACCENT_KEYS`) lives in its own
// leaf module (`./accents`, no imports) so `@/stores/theme.store` can read it
// without importing this file — which imports the store — breaking the require
// cycle. Re-exported here so `@/theme` stays the single public entry point.
export { ACCENTS, ACCENT_KEYS };
export type { AccentKey, AccentSelection };

/** Transient subtree palette; draft appearance never changes persisted preferences. */
export const ThemeColorsContext = createContext<ThemeColors | null>(null);

export function useThemeColors(): ThemeColors {
  const localColors = useContext(ThemeColorsContext);
  const scheme = useEffectiveColorScheme();
  return useThemeStore((state) => localColors ?? (state.palettes ?? defaultThemePalettes)[scheme]);
}

export { spacing } from './spacing';

/** Optical chat spacing that is intentionally tighter than the global scale. */
export const messageLayout = {
  reactionGap: spacing.xs / 2,
} as const;

/** Shared outer alignment for every mode inside the full emoji picker. */
export const emojiPickerLayout = {
  horizontalGutter: IS_ELECTRON ? spacing.sm : spacing.lg,
  contentTopGap: spacing.xs,
} as const;

/** Runtime height (above the home-indicator safe area) of the app's bottom bars — the
 * tab bar and the chat composer's input row — kept equal so switching between a
 * tab screen and a chat doesn't shift the bottom edge. The safe-area inset is
 * added on top of this by each bar. */
export const uiDensity = IS_ELECTRON ? density.desktop : density.mobile;
/** Runtime-sized numeric badge geometry shared by navigation and content. */
export const countBadge = uiDensity.countBadge;
export const bottomBarHeight = uiDensity.bottomBarHeight;

/** Runtime title-bar height below the top safe area. */
export const headerHeight = uiDensity.headerHeight;

export const radius = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  '2xl': 24,
  full: 9999,
} as const;

/**
 * Soft float shadow for surfaces that *hover over other content* — a menu or
 * pill floating above a backdrop (`MessageActionMenu`, the composer attachment
 * menu). On-page cards stay **shadowless** (DESIGN §5, border/elevation only);
 * this is reserved for things that sit over blurred or scrolling content and
 * need their own definition. Theme-independent — depth, not colour.
 */
export const shadow = {
  float: {
    boxShadow: '0px 6px 16px rgba(0, 0, 0, 0.12)',
    elevation: 8,
  },
  /** Slightly deeper definition for brief notices over changing page content. */
  notice: {
    boxShadow: '0px 8px 24px rgba(0, 0, 0, 0.18)',
    elevation: 10,
  },
  /** Keeps light text legible when it is painted over user-controlled media
   * whose luminance is unknown. This is a text shadow, not surface elevation.
   * RN Web deprecates the `textShadow*` longhands in favour of the CSS
   * `textShadow` shorthand; native still needs the longhand props. */
  mediaText: (Platform.OS === 'web'
    ? ({ textShadow: '0px 1px 3px rgba(0,0,0,0.85)' } as TextStyle)
    : {
        textShadowColor: 'rgba(0,0,0,0.85)',
        textShadowOffset: { width: 0, height: 1 },
        textShadowRadius: 3,
      }),
} as const;

/**
 * Emoji are *user content*, not chrome (DESIGN §1), so they're exempt from the
 * variant scale — but their sizes still live here as named constants rather
 * than scattered magic numbers.
 */
export const emojiSize = {
  /** Unicode emoji inside a reaction chip. */
  chip: { fontSize: 13, lineHeight: 16 },
  /** Custom-emoji image inside a reaction chip. */
  reactionImage: 16,
  /** The quick-reaction pill above a long-pressed message. */
  picker: { fontSize: 28, lineHeight: 32 },
  /** Unicode emoji in the mobile message-action quick-reaction pill. */
  quickReactionPill: { fontSize: 20, lineHeight: 24 },
  /** Custom-emoji image in the mobile message-action quick-reaction pill. */
  quickReactionPillImage: 20,
  /** Custom-emoji image in quick-reaction editor tiles. */
  quickReactionImage: 28,
  /** The full emoji-picker grid cell. */
  grid: { fontSize: 30, lineHeight: 36 },
  /** Unicode emoji in the Electron full-picker grid. */
  desktopGrid: { fontSize: 26, lineHeight: 32 },
  /** Use natural emoji font metrics on every platform. */
  message: {
    fontSize: 80,
    includeFontPadding: true,
  },
  /** Inline custom-emoji image inside a text bubble. */
  inlineImage: 22,
  /** Custom-emoji cover in the picker source tab rail. */
  sourceTabImage: 32,
  /** Custom-emoji cover in the Electron picker source tab rail. */
  desktopSourceTabImage: 28,
  /** Custom-emoji artwork in the composer's floating shortcode suggestion strip. */
  composerSuggestionImage: IS_ELECTRON ? 48 : 64,
  /** Custom-emoji image in touch picker and pack grids. */
  composerPickerImage: 68,
  /** Custom-emoji thumbnail in a pack row, matching a conversation avatar. */
  listImage: 44,
  /** Bubble-free custom-emoji message image. */
  messageImage: 150,
  /** Emoji tile in pack previews and management grids. */
  packImage: 48,
  /** Selected emoji shown at the top of the detail sheet. */
  detailImage: 160,
} as const;
