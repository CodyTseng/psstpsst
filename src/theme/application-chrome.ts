import type { PageAppearance } from '@/lib/page-appearance';
import { darkPalette, lightPalette, type ThemeColors } from './palette';

const documentForeground = { light: '#000000', dark: '#ffffff' } as const;

/** A document may color runtime chrome without recoloring trusted host overlays. */
export function applicationChromeColors(host: ThemeColors, appearance?: PageAppearance): ThemeColors {
  if (!appearance) return host;
  const text = documentForeground[appearance.dark ? 'dark' : 'light'];
  return {
    ...host,
    background: appearance.background,
    surfaceMuted: appearance.background,
    text,
    // Disabled chrome controls apply their own opacity to this foreground.
    textMuted: text,
    interactionOverlay: (appearance.dark ? darkPalette : lightPalette).interactionOverlay,
  };
}
