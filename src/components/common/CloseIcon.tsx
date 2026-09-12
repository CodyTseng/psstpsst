import { memo } from 'react';
import Svg, { Path } from 'react-native-svg';

type Props = {
  color: string;
  size: number;
};

export const CloseIcon = memo(function CloseIcon({ color, size }: Props) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Path
        d="M6 6L18 18M18 6L6 18"
        stroke={color}
        strokeWidth={1.5}
        strokeLinecap="round"
      />
    </Svg>
  );
});
