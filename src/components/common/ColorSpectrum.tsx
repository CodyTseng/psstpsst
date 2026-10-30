import { useId } from 'react';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';

import { colorPickerColors } from '@/theme/color-picker';

/** Continuous spectral artwork for the hue track. */
export function ColorSpectrum({ vertical = false }: { vertical?: boolean }) {
  const id = useId();
  return (
    <Svg width="100%" height="100%" pointerEvents="none">
      <Defs>
        <LinearGradient id={id} x1="0%" y1="0%" x2={vertical ? '0%' : '100%'} y2={vertical ? '100%' : '0%'}>
          {colorPickerColors.spectrum.map((color, index) => (
            <Stop key={index} offset={index / (colorPickerColors.spectrum.length - 1)} stopColor={color} />
          ))}
        </LinearGradient>
      </Defs>
      <Rect width="100%" height="100%" fill={`url(#${id})`} />
    </Svg>
  );
}
