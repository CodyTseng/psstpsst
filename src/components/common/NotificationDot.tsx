import { View, type ViewStyle } from 'react-native';

import { useThemeColors } from '@/theme';

/**
 * A small solid `notification`-red dot — a count-less "there's something new"
 * cue (cf. {@link CountBadge}, which carries a number). Use it where a number
 * would be noise and mere presence is the signal (e.g. the Contacts header's
 * search-user button when requests are waiting). Position it with `style`
 * (absolute, over the target icon's top-right corner). No border.
 */
export function NotificationDot({ size = 8, style }: { size?: number; style?: ViewStyle }) {
  const c = useThemeColors();
  return (
    <View
      style={[
        {
          width: size,
          height: size,
          borderRadius: size / 2,
          backgroundColor: c.notification,
        },
        style,
      ]}
    />
  );
}
