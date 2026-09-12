/**
 * Selectable accent (brand) colours — the one palette entry the user may change
 * (Settings → Appearance). Each key carries a light and dark pairing of the
 * `accent` glyph/fill colour and its `accentSoft` tint, hand-tuned per mode so
 * the soft tint reads as a faint wash in light and a deep fill in dark (cf. the
 * base palettes). `accentForeground` stays white for all, so it's not repeated
 * here. `blue` is the default and **must** equal the base palettes'
 * accent/accentSoft so an un-changed install is byte-identical to before.
 *
 * Kept in its own leaf module (no imports) so `@/stores/theme.store` can read
 * `ACCENTS` without importing `@/theme` (which imports the store). That mutual
 * import is the require cycle this split removes. `@/theme` re-exports these, so
 * it stays the single public entry point.
 */
export type AccentKey =
  | 'blue'
  | 'cyan'
  | 'teal'
  | 'green'
  | 'amber'
  | 'orange'
  | 'rose'
  | 'pink'
  | 'fuchsia'
  | 'purple'
  | 'indigo'
  | 'slate';

type AccentTones = { accent: string; accentSoft: string };

// Ordered around the colour wheel (warm → cool) so the swatch grid reads as a
// spectrum, with the neutral slate last. Each pairing is hand-tuned per mode.
export const ACCENTS: Record<AccentKey, { light: AccentTones; dark: AccentTones }> = {
  blue: { light: { accent: '#3A76F0', accentSoft: '#E6EEFE' }, dark: { accent: '#5B8DF6', accentSoft: '#162844' } },
  cyan: { light: { accent: '#0891B2', accentSoft: '#CFFAFE' }, dark: { accent: '#22D3EE', accentSoft: '#083344' } },
  teal: { light: { accent: '#0D9488', accentSoft: '#CCFBF1' }, dark: { accent: '#2DD4BF', accentSoft: '#042F2E' } },
  green: { light: { accent: '#16A34A', accentSoft: '#DCFCE7' }, dark: { accent: '#4ADE80', accentSoft: '#052E16' } },
  amber: { light: { accent: '#D97706', accentSoft: '#FEF3C7' }, dark: { accent: '#FBBF24', accentSoft: '#451A03' } },
  orange: { light: { accent: '#EA580C', accentSoft: '#FFEDD5' }, dark: { accent: '#FB923C', accentSoft: '#431407' } },
  rose: { light: { accent: '#E11D48', accentSoft: '#FFE4E6' }, dark: { accent: '#FB7185', accentSoft: '#4C0519' } },
  pink: { light: { accent: '#DB2777', accentSoft: '#FCE7F3' }, dark: { accent: '#F472B6', accentSoft: '#500724' } },
  fuchsia: { light: { accent: '#C026D3', accentSoft: '#FAE8FF' }, dark: { accent: '#E879F9', accentSoft: '#4A044E' } },
  purple: { light: { accent: '#7C3AED', accentSoft: '#EDE9FE' }, dark: { accent: '#A78BFA', accentSoft: '#2E1065' } },
  indigo: { light: { accent: '#4F46E5', accentSoft: '#E0E7FF' }, dark: { accent: '#818CF8', accentSoft: '#1E1B4B' } },
  slate: { light: { accent: '#475569', accentSoft: '#E2E8F0' }, dark: { accent: '#94A3B8', accentSoft: '#1E293B' } },
};

export const ACCENT_KEYS = Object.keys(ACCENTS) as AccentKey[];
