import { useId } from 'react';
import Svg, { Circle, Defs, Path, RadialGradient, Stop } from 'react-native-svg';

import { colorPickerColors, colorPickerWheelSegments } from '@/theme/color-picker';

/** Radial spectrum: a pale centre fans out into the full hue wheel. */
export function ColorWheelSwatch() {
  const id = useId();
  return (
    <Svg width="100%" height="100%" viewBox="0 0 100 100" pointerEvents="none">
      <Defs>
        <RadialGradient id={id} cx="50%" cy="50%" r="50%">
          <Stop offset="0" stopColor={colorPickerColors.white} />
          <Stop offset="1" stopColor={colorPickerColors.white} stopOpacity={0} />
        </RadialGradient>
      </Defs>
      {colorPickerWheelSegments.map(({ hue, path, color }) => (
        <Path key={hue} d={path} fill={color} />
      ))}
      <Circle cx="50" cy="50" r="50" fill={`url(#${id})`} />
    </Svg>
  );
}
