import { Platform, type TextStyle } from 'react-native';

import { IS_ELECTRON } from '@/lib/platform';
import { useThemeStore } from '@/stores/theme.store';

import { ACCENTS, ACCENT_KEYS, type AccentKey } from './accents';
import { useEffectiveColorScheme } from './effective-color-scheme';
import { density } from './layout';
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

export type ThemeColors = {
  background: string;
  surface: string;
  surfaceElevated: string;
  surfaceMuted: string;
  /** Theme-aware neutral overlay shared by hover and pressed states. It is
   * composited above each control's resting fill instead of replacing it. */
  interactionOverlay: string;
  /** Quiet translucent fill for a neutral inset surface such as a quoted reply. */
  insetFill: string;
  border: string;
  text: string;
  textMuted: string;
  accent: string;
  accentSoft: string;
  accentForeground: string;
  /** Secondary text on an accent-coloured surface. */
  accentForegroundMuted: string;
  /** Quiet inset fill on an accent-coloured surface. */
  accentForegroundSoft: string;
  danger: string;
  dangerSoft: string;
  warning: string;
  warningSoft: string;
  success: string;
  successSoft: string;
  /** Unread / notification count badge red — a softer red than `danger`, which
   * is reserved for destructive actions. */
  notification: string;
  /** Scrim over images/banners (functional, identical in light & dark). */
  overlay: string;
  overlayStrong: string;
  /** Stable button contrast over media, independent of the image or app theme. */
  overlayControl: string;
  overlayControlActive: string;
  /** Theme-dependent scrim behind a summoned sheet. It sits over a page painted
   * in `background`; the dark theme deepens it because the raised sheet needs
   * the page to recede further to read as a separate layer. */
  sheetBackdrop: string;
  /** The summoned sheet's own canvas. Light mode uses the page `background`
   * (cards on the sheet are white and float on the grey); dark mode raises one
   * ladder step to `surface`, because the sheet must stand out from the
   * near-black page it covers — a same-colour sheet on a dark-scrimmed black
   * page has no visible edge. */
  sheetBackground: string;
  /** Opaque black canvas behind the full-screen image lightbox — solid (not a
   * translucent scrim) so the photo sits on black, not on a see-through page. */
  lightboxBackdrop: string;
  /** Icon/text color on top of an overlay scrim (always white). */
  onOverlay: string;
};

// Overlay scrims over media are deliberately theme-independent: a dark scrim
// over a photo reads the same regardless of app theme, so both palettes share
// these values. The sheet backdrop is the exception — see `sheetBackdrop`.
const OVERLAY = 'rgba(0,0,0,0.4)';
const OVERLAY_STRONG = 'rgba(0,0,0,0.6)';const LIGHTBOX_BACKDROP = '#000000';
const OVERLAY_CONTROL = 'rgba(32,32,36,0.88)';
const OVERLAY_CONTROL_ACTIVE = 'rgba(72,72,80,0.88)';
const ON_OVERLAY = '#FFFFFF';
const ACCENT_FOREGROUND_MUTED = 'rgba(255,255,255,0.8)';
const ACCENT_FOREGROUND_SOFT = 'rgba(255,255,255,0.18)';

export const lightPalette: ThemeColors = {
  // Single iOS-style grouped page colour app-wide: a soft grey page on which
  // white `surface`/`surfaceElevated` cards, bubbles and chips float.
  background: '#F2F2F7',
  surface: '#FFFFFF',
  surfaceElevated: '#FFFFFF',
  surfaceMuted: '#E5E5EA',
  interactionOverlay: 'rgba(15,15,16,0.08)',
  insetFill: 'rgba(15,15,16,0.05)',
  border: '#E2E2E7',
  text: '#0F0F10',
  textMuted: '#6B6B73',
  accent: '#3A76F0',
  accentSoft: '#E6EEFE',
  accentForeground: '#FFFFFF',
  accentForegroundMuted: ACCENT_FOREGROUND_MUTED,
  accentForegroundSoft: ACCENT_FOREGROUND_SOFT,
  danger: '#D6342E',
  dangerSoft: '#FCE9E8',
  warning: '#B45309',
  warningSoft: '#FEF3C7',
  success: '#16A34A',
  successSoft: '#DCFCE7',
  notification: '#F2564B',
  overlay: OVERLAY,
  overlayStrong: OVERLAY_STRONG,
  overlayControl: OVERLAY_CONTROL,
  overlayControlActive: OVERLAY_CONTROL_ACTIVE,
  sheetBackdrop: OVERLAY,
  // Same as the page: white cards float on the grey sheet, iOS-grouped style.
  sheetBackground: '#F2F2F7',
  lightboxBackdrop: LIGHTBOX_BACKDROP,
  onOverlay: ON_OVERLAY,
};

export const darkPalette: ThemeColors = {
  background: '#09090B',
  surface: '#141416',
  surfaceElevated: '#1A1A1D',
  surfaceMuted: '#101013',
  interactionOverlay: 'rgba(255,255,255,0.08)',
  insetFill: 'rgba(255,255,255,0.06)',
  border: '#26262A',
  text: '#F5F5F7',
  textMuted: '#A1A1A8',
  accent: '#5B8DF6',
  accentSoft: '#162844',
  accentForeground: '#FFFFFF',
  accentForegroundMuted: ACCENT_FOREGROUND_MUTED,
  accentForegroundSoft: ACCENT_FOREGROUND_SOFT,
  // A saturated red, not the pale red-400 it used to be — on the near-black dark
  // surfaces a light pink read as washed-out (delete button, unread badge).
  danger: '#EF4444',
  dangerSoft: '#3A1A1A',
  warning: '#F59E0B',
  warningSoft: '#3A2A0F',
  success: '#22C55E',
  successSoft: '#15351F',
  notification: '#F2564B',
  overlay: OVERLAY,
  overlayStrong: OVERLAY_STRONG,
  overlayControl: OVERLAY_CONTROL,
  overlayControlActive: OVERLAY_CONTROL_ACTIVE,
  sheetBackdrop: OVERLAY_STRONG,
  // One ladder step above the near-black page (`surface`): the sheet stands
  // out from the dark-scrimmed page without a border, shadow, or tinted veil.
  sheetBackground: '#141416',
  lightboxBackdrop: LIGHTBOX_BACKDROP,
  onOverlay: ON_OVERLAY,
};

// The accent palette (`AccentKey`, `ACCENTS`, `ACCENT_KEYS`) lives in its own
// leaf module (`./accents`, no imports) so `@/stores/theme.store` can read it
// without importing this file — which imports the store — breaking the require
// cycle. Re-exported here so `@/theme` stays the single public entry point.
export { ACCENTS, ACCENT_KEYS };
export type { AccentKey };

// Memoised per (scheme, accent) so identical inputs return the SAME object
// reference. useThemeColors() runs in nearly every component; returning a fresh
// spread each render would defeat any `useMemo([c])` downstream and force needless
// re-renders. The cache is tiny (2 × accent count) and lives for the app session.
const paletteCache = new Map<string, ThemeColors>();

function resolvePalette(scheme: 'light' | 'dark', accent: AccentKey): ThemeColors {
  const cacheKey = `${scheme}:${accent}`;
  const cached = paletteCache.get(cacheKey);
  if (cached) return cached;
  const base = scheme === 'dark' ? darkPalette : lightPalette;
  const tones = (ACCENTS[accent] ?? ACCENTS.blue)[scheme];
  const palette: ThemeColors = { ...base, accent: tones.accent, accentSoft: tones.accentSoft };
  paletteCache.set(cacheKey, palette);
  return palette;
}

export function useThemeColors(): ThemeColors {
  const scheme = useEffectiveColorScheme();
  const accent = useThemeStore((s) => s.accent);
  return resolvePalette(scheme, accent);
}

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  '2xl': 32,
  '3xl': 48,
} as const;

/** Shared outer alignment for every mode inside the full emoji picker. */
export const emojiPickerLayout = {
  horizontalGutter: IS_ELECTRON ? spacing.sm : spacing.lg,
  contentTopGap: spacing.xs,
  endFadeWidth: spacing['3xl'],
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
  /** Bubble-free messages containing at most three emoji. */
  message: { fontSize: 80, lineHeight: 88 },
  /**
   * Bubble-free message containing exactly one emoji. Electron's color-emoji
   * bitmaps pixelate at the larger size, so a lone emoji settles between
   * `message` and the touch size.
   */
  singleMessage: IS_ELECTRON ? { fontSize: 112, lineHeight: 124 } : { fontSize: 160, lineHeight: 176 },
  /** Inline custom-emoji image inside a text bubble. */
  inlineImage: 22,
  /** Custom-emoji cover in the picker source tab rail. */
  sourceTabImage: 32,
  /** Custom-emoji cover in the Electron picker source tab rail. */
  desktopSourceTabImage: 28,
  /** Custom-emoji artwork in the composer's floating shortcode suggestion strip. */
  composerSuggestionImage: IS_ELECTRON ? 48 : 64,
  /** Custom-emoji image in touch picker and pack grids. */
  composerPickerImage: 64,
  /** Custom-emoji thumbnail in a pack row, matching a conversation avatar. */
  listImage: 44,
  /** Bubble-free custom-emoji message image. */
  messageImage: 80,
  /** Bubble-free message containing exactly one custom emoji. Matches `singleMessage`. */
  singleMessageImage: IS_ELECTRON ? 112 : 160,
  /** Emoji tile in pack previews and management grids. */
  packImage: 48,
  /** Selected emoji shown at the top of the detail sheet. */
  detailImage: 160,
} as const;
