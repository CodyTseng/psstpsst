import { customAccentTones, isCustomAccent, presetAccentTones, resolveAccentPair, type AccentKey, type AccentSelection } from './accents';

export type ThemeColors = {
  background: string;
  surface: string;
  surfaceElevated: string;
  /** Highest neutral surface for transient notices above page content. */
  surfaceFloating: string;
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

export const lightPalette: ThemeColors = {
  // Single iOS-style grouped page colour app-wide: a soft grey page on which
  // white `surface`/`surfaceElevated` cards, bubbles and chips float.
  background: '#F2F2F7',
  surface: '#FFFFFF',
  surfaceElevated: '#FFFFFF',
  surfaceFloating: '#FFFFFF',
  surfaceMuted: '#E5E5EA',
  interactionOverlay: 'rgba(15,15,16,0.08)',
  insetFill: 'rgba(15,15,16,0.05)',
  border: '#E2E2E7',
  text: '#0F0F10',
  textMuted: '#6B6B73',
  ...presetAccentTones('blue', 'light'),
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
  surfaceFloating: '#232327',
  surfaceMuted: '#101013',
  interactionOverlay: 'rgba(255,255,255,0.08)',
  insetFill: 'rgba(255,255,255,0.06)',
  border: '#26262A',
  text: '#F5F5F7',
  textMuted: '#A1A1A8',
  ...presetAccentTones('blue', 'dark'),
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

/** The mode pair for the currently selected accent, not a history of selections. */
export type ThemePalettes = { light: ThemeColors; dark: ThemeColors };

export const defaultThemePalettes: ThemePalettes = { light: lightPalette, dark: darkPalette };

export function createThemePalettes(accent: AccentSelection): ThemePalettes {
  if (accent === 'blue') return defaultThemePalettes;
  const pair = resolveAccentPair(accent);
  const resolve = (scheme: 'light' | 'dark'): ThemeColors => {
    const base = defaultThemePalettes[scheme];
    const tones = isCustomAccent(accent)
      ? customAccentTones(pair[scheme].color, base.background, pair[scheme].foreground)
      : presetAccentTones(accent as AccentKey, scheme);
    return { ...base, ...tones };
  };
  return { light: resolve('light'), dark: resolve('dark') };
}
