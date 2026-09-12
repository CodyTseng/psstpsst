import { type StyleProp, View, type ViewStyle } from 'react-native';

import { IS_ELECTRON } from '@/lib/platform';
import { type FontWeight, type TextVariant } from '@/theme';

import { AppText } from './AppText';

const DEFAULT_SUFFIX_LENGTH = 8;

type Props = {
  value: string;
  color: string;
  variant?: TextVariant;
  weight?: FontWeight;
  suffixLength?: number;
  style?: StyleProp<ViewStyle>;
};

/**
 * One-line technical text that preserves both ends. Native platforms use their
 * real middle-ellipsis implementation; Electron keeps a fixed suffix beside a
 * shrinkable leading segment because React Native Web falls back to tail-only
 * truncation for `ellipsizeMode="middle"`.
 */
export function MiddleEllipsizedText({
  value,
  color,
  variant = 'body',
  weight,
  suffixLength = DEFAULT_SUFFIX_LENGTH,
  style,
}: Props) {
  const shouldSplit = IS_ELECTRON && value.length > suffixLength;
  const suffixStart = Math.max(1, value.length - suffixLength);

  return (
    <View
      accessible
      accessibilityLabel={value}
      style={[{ flexDirection: 'row', minWidth: 0 }, style]}
    >
      <AppText
        variant={variant}
        weight={weight}
        numberOfLines={1}
        ellipsizeMode={shouldSplit ? 'tail' : 'middle'}
        style={{ color, flexShrink: 1 }}
      >
        {shouldSplit ? value.slice(0, suffixStart) : value}
      </AppText>
      {shouldSplit ? (
        <AppText
          variant={variant}
          weight={weight}
          numberOfLines={1}
          style={{ color, flexShrink: 0 }}
        >
          {value.slice(suffixStart)}
        </AppText>
      ) : null}
    </View>
  );
}
