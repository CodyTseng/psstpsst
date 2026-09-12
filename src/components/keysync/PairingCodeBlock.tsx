import { type ReactNode } from 'react';
import { type StyleProp, View, type ViewStyle } from 'react-native';

import { AppText } from '@/components/common/AppText';
import { SectionLabel } from '@/components/common/SectionLabel';
import { radius, useThemeColors } from '@/theme';

// The wide tracking that turns the pairing code into a readable group of
// glyphs. A controlled display exception to the no-inline-letterSpacing rule
// (DESIGN §3), kept here so it lives in exactly one place.
const CODE_TRACKING = { letterSpacing: 6 } as const;

type Props = {
  label: string;
  code: string;
  /** `hero` = full-screen sync gate (accent box, display code); `compact` =
   * inside the approval bottom sheet (muted box, title code). */
  emphasis?: 'hero' | 'compact';
  children?: ReactNode;
  style?: StyleProp<ViewStyle>;
};

/** The boxed "PAIRING CODE / XXXX XXXX" panel shared by both key-sync screens. */
export function PairingCodeBlock({ label, code, emphasis = 'compact', children, style }: Props) {
  const c = useThemeColors();
  const hero = emphasis === 'hero';

  return (
    <View
      style={[
        {
          alignItems: 'center',
          gap: hero ? 12 : 8,
          paddingVertical: hero ? 24 : 16,
          paddingHorizontal: 16,
          borderRadius: radius.xl,
          backgroundColor: hero ? c.accentSoft : c.surfaceMuted,
        },
        style,
      ]}
    >
      <SectionLabel>{label}</SectionLabel>
      <AppText variant={hero ? 'display' : 'title'} weight="bold" style={CODE_TRACKING}>
        {code || '— —'}
      </AppText>
      {children}
    </View>
  );
}
