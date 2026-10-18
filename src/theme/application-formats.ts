import { ACCENTS } from './accents';

/** Format identity stays independent of selectable accents and status colours. */
export const applicationFormatColors = {
  napplet: {
    light: { text: '#6D28D9', background: ACCENTS.purple.light.accentSoft },
    dark: { text: ACCENTS.purple.dark.accent, background: ACCENTS.purple.dark.accentSoft },
  },
  napp: {
    light: { text: '#1D4ED8', background: ACCENTS.blue.light.accentSoft },
    dark: { text: ACCENTS.blue.dark.accent, background: ACCENTS.blue.dark.accentSoft },
  },
  nsite: {
    light: { text: '#0F766E', background: ACCENTS.teal.light.accentSoft },
    dark: { text: ACCENTS.teal.dark.accent, background: ACCENTS.teal.dark.accentSoft },
  },
  website: {
    light: { text: ACCENTS.slate.light.accent, background: ACCENTS.slate.light.accentSoft },
    dark: { text: ACCENTS.slate.dark.accent, background: ACCENTS.slate.dark.accentSoft },
  },
} as const;
