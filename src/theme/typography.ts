import { IS_ELECTRON } from '@/lib/platform';

export const desktopUiFontFamily =
  '-apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif';

export const mobileFontWeight = {
  regular: '400' as const,
  medium: '500' as const,
  semibold: '600' as const,
  bold: '700' as const,
};

export const desktopFontWeight = {
  regular: '400' as const,
  medium: '500' as const,
  semibold: '500' as const,
  bold: '700' as const,
};

export type FontWeight = keyof typeof mobileFontWeight;

export type TextVariant =
  | 'amount'
  | 'display'
  | 'title'
  | 'subtitle'
  | 'message'
  | 'body'
  | 'caption'
  | 'code'
  | 'micro';

type TextMetric = {
  fontSize: number;
  lineHeight: number;
  weight: FontWeight;
  fontFamily?: string;
};

export const mobileTypography: Record<TextVariant, TextMetric> = {
  amount: { fontSize: 54, lineHeight: 62, weight: 'bold' },
  display: { fontSize: 30, lineHeight: 36, weight: 'bold' },
  title: { fontSize: 22, lineHeight: 28, weight: 'semibold' },
  subtitle: { fontSize: 17, lineHeight: 24, weight: 'semibold' },
  message: { fontSize: 16, lineHeight: 22, weight: 'regular' },
  body: { fontSize: 15, lineHeight: 22, weight: 'regular' },
  caption: { fontSize: 13, lineHeight: 18, weight: 'medium' },
  code: { fontSize: 13, lineHeight: 20, weight: 'regular', fontFamily: 'Menlo' },
  micro: { fontSize: 11, lineHeight: 14, weight: 'medium' },
};

export const desktopTypography: Record<TextVariant, TextMetric> = {
  amount: {
    fontSize: 50,
    lineHeight: 58,
    weight: 'bold',
    fontFamily: desktopUiFontFamily,
  },
  display: {
    fontSize: 28,
    lineHeight: 34,
    weight: 'bold',
    fontFamily: desktopUiFontFamily,
  },
  title: {
    fontSize: 20,
    lineHeight: 26,
    weight: 'semibold',
    fontFamily: desktopUiFontFamily,
  },
  subtitle: {
    fontSize: 15,
    lineHeight: 21,
    weight: 'semibold',
    fontFamily: desktopUiFontFamily,
  },
  message: {
    fontSize: 15,
    lineHeight: 21,
    weight: 'regular',
    fontFamily: desktopUiFontFamily,
  },
  body: {
    fontSize: 14,
    lineHeight: 20,
    weight: 'regular',
    fontFamily: desktopUiFontFamily,
  },
  caption: {
    fontSize: 12,
    lineHeight: 16,
    weight: 'regular',
    fontFamily: desktopUiFontFamily,
  },
  code: { fontSize: 12, lineHeight: 18, weight: 'regular', fontFamily: 'Menlo' },
  micro: {
    fontSize: 10,
    lineHeight: 13,
    weight: 'medium',
    fontFamily: desktopUiFontFamily,
  },
};

export const fontWeight = IS_ELECTRON ? desktopFontWeight : mobileFontWeight;
export const typography = IS_ELECTRON ? desktopTypography : mobileTypography;
