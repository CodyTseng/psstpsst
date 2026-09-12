import { type StyleProp, type TextStyle } from 'react-native';

import { type FontWeight } from '@/theme';

import { AppText } from './AppText';

type Props = {
  children: React.ReactNode;
  /** Defaults to `medium`; pass `semibold` for denser sticky headers. */
  weight?: FontWeight;
  style?: StyleProp<TextStyle>;
};

// The one canonical "overline" treatment (uppercase + tracking) used for the
// small grey labels above form/settings sections. Encapsulated so the
// textTransform/letterSpacing live in exactly one place (DESIGN §8).
const OVERLINE: TextStyle = { textTransform: 'uppercase', letterSpacing: 0.5 };

export function SectionLabel({ children, weight = 'medium', style }: Props) {
  return (
    <AppText variant="caption" tone="subtle" weight={weight} style={[OVERLINE, style]}>
      {children}
    </AppText>
  );
}
