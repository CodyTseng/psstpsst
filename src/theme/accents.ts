/**
 * Selectable accent (brand) colours — the one palette entry the user may change
 * (Settings → Appearance). Each key carries a light and dark pairing of the
 * `accent` glyph/fill colour and its `accentSoft` tint, hand-tuned per mode so
 * the soft tint reads as a faint wash in light and a deep fill in dark (cf. the
 * base palettes). Presets use white foregrounds; custom foregrounds are explicitly selected.
 * `blue` is the default and supplies the base palettes' accent/accentSoft.
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

export type AccentMode = 'light' | 'dark';
export type AccentForeground = 'white' | 'black';
export type AccentModeColor = { color: `#${string}`; foreground: AccentForeground };
/** An unset mode follows the other mode until the user explicitly edits it. */
export type CustomAccent = { light?: AccentModeColor; dark?: AccentModeColor };
export type AccentSelection = AccentKey | `#${string}` | CustomAccent;

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

/** Normalize opaque RGB only; alpha and CSS expressions are not theme colours. */
export function normalizeCustomAccent(value: string): `#${string}` | null {
  const hex = value.trim().replace(/^#/, '');
  if (/^[0-9a-f]{3}$/i.test(hex)) {
    return `#${hex.split('').map((digit) => digit + digit).join('').toUpperCase()}`;
  }
  return /^[0-9a-f]{6}$/i.test(hex) ? `#${hex.toUpperCase()}` : null;
}

/** Accept existing preset/HEX preferences as well as the paired custom format. */
export function parseAccent(value: unknown): AccentSelection | null {
  if (typeof value === 'string') {
    if (Object.hasOwn(ACCENTS, value)) return value as AccentKey;
    const hex = normalizeCustomAccent(value);
    if (hex) return hex;
    if (!value.startsWith('{')) return null;
    try { return parseAccent(JSON.parse(value)); } catch { return null; }
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const result: CustomAccent = {};
  for (const mode of ['light', 'dark'] as const) {
    if (!Object.hasOwn(value, mode)) continue;
    const entry = (value as Record<string, unknown>)[mode];
    if (!entry || typeof entry !== 'object') return null;
    const { color, foreground = 'white' } = entry as Record<string, unknown>;
    const normalized = typeof color === 'string' ? normalizeCustomAccent(color) : null;
    if (!normalized || (foreground !== 'white' && foreground !== 'black')) return null;
    result[mode] = { color: normalized, foreground };
  }
  return result.light || result.dark ? result : null;
}

export function serializeAccent(accent: AccentSelection): string {
  return typeof accent === 'string' ? accent : JSON.stringify(accent);
}

export function isCustomAccent(accent: AccentSelection): accent is `#${string}` | CustomAccent {
  return typeof accent !== 'string' || accent.startsWith('#');
}

/** Resolve the physical light/dark colours without changing either chosen RGB. */
export function resolveAccentPair(accent: AccentSelection): Record<AccentMode, AccentModeColor> {
  if (typeof accent === 'string') {
    if (isCustomAccent(accent)) {
      return { light: { color: accent, foreground: 'white' }, dark: { color: accent, foreground: 'white' } };
    }
    return {
      light: { color: ACCENTS[accent].light.accent as `#${string}`, foreground: 'white' },
      dark: { color: ACCENTS[accent].dark.accent as `#${string}`, foreground: 'white' },
    };
  }
  const fallback = accent.light ?? accent.dark ?? { color: ACCENTS.blue.light.accent as `#${string}`, foreground: 'white' as const };
  return { light: accent.light ?? fallback, dark: accent.dark ?? fallback };
}

type RGB = [number, number, number];

function rgb(hex: string): RGB {
  return [1, 3, 5].map((offset) => parseInt(hex.slice(offset, offset + 2), 16)) as RGB;
}

function mix(color: RGB, target: RGB, amount: number): RGB {
  return color.map((channel, index) =>
    Math.round(channel + (target[index] - channel) * amount)) as RGB;
}

function hex(color: RGB): string {
  return '#' + color.map((channel) => channel.toString(16).padStart(2, '0')).join('').toUpperCase();
}

/** Foreground is a user choice, never inferred from colour or appearance mode. */
export function accentForegroundTones(foreground: AccentForeground = 'white') {
  const dark = foreground === 'black';
  return {
    accentForeground: dark ? '#000000' : '#FFFFFF',
    accentForegroundMuted: dark ? 'rgba(0,0,0,0.8)' : 'rgba(255,255,255,0.8)',
    accentForegroundSoft: dark ? 'rgba(0,0,0,0.18)' : 'rgba(255,255,255,0.18)',
  };
}

export function presetAccentTones(key: AccentKey, scheme: 'light' | 'dark') {
  const tones = ACCENTS[key][scheme];
  return { ...tones, ...accentForegroundTones() };
}

/** Preserve the chosen RGB exactly; adapt only supporting fills and foregrounds. */
export function customAccentTones(color: `#${string}`, background: string, foreground: AccentForeground = 'white') {
  return {
    accent: color,
    accentSoft: hex(mix(rgb(color), rgb(background), 0.88)),
    ...accentForegroundTones(foreground),
  };
}
