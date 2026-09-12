import { Text, type TextProps } from 'react-native';
import { useTranslation } from 'react-i18next';

import { getLanguageDirection } from '@/i18n/direction';
import { type FontWeight, fontWeight, type TextVariant, typography, useThemeColors } from '@/theme';

type Tone =
  | 'default'
  | 'muted'
  | 'subtle'
  | 'accent'
  | 'danger'
  | 'warning'
  | 'success'
  | 'inverse';

// Logical alignment — `start`/`end` resolve against the writing direction so
// the same code reads correctly in LTR and RTL (Arabic and Persian) locales. Never
// pass a raw `left`/`right` textAlign in app code (DESIGN §3 alignment rules).
type Align = 'start' | 'center' | 'end' | 'justify';

function resolveAlign(align: Align, isRTL: boolean): 'left' | 'center' | 'right' | 'justify' {
  if (align === 'center' || align === 'justify') return align;
  const isStart = align === 'start';
  return isRTL === isStart ? 'right' : 'left';
}

type Props = TextProps & {
  variant?: TextVariant;
  tone?: Tone;
  weight?: FontWeight;
  align?: Align;
  /** Language of verbatim content when it differs from the app locale. */
  language?: string;
};

export function AppText({
  variant = 'body',
  tone = 'default',
  weight,
  align = 'start',
  language: contentLanguage,
  style,
  ...rest
}: Props) {
  const c = useThemeColors();
  const { i18n } = useTranslation();
  const language = contentLanguage ?? i18n?.resolvedLanguage ?? i18n?.language ?? 'en';
  const isRTL = getLanguageDirection(language) === 'rtl';
  const webLanguageProps = { lang: language } as unknown as TextProps;
  const v = typography[variant];

  const toneColor: Record<Tone, string> = {
    default: c.text,
    muted: c.textMuted,
    subtle: c.textMuted,
    accent: c.accent,
    danger: c.danger,
    warning: c.warning,
    success: c.success,
    inverse: c.background,
  };

  return (
    <Text
      {...rest}
      {...webLanguageProps}
      style={[
        {
          fontSize: v.fontSize,
          lineHeight: v.lineHeight,
          fontWeight: fontWeight[weight ?? v.weight],
          fontFamily: v.fontFamily,
          color: toneColor[tone],
          textAlign: resolveAlign(align, isRTL),
        },
        style,
      ]}
    />
  );
}
