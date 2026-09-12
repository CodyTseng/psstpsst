import Svg, { Circle, Path } from 'react-native-svg';

/** Unframed status mark for controls that already provide a circular surface. */
export function ExclamationIcon({ size, color }: { size: number; color: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path d="M12 5V14" stroke={color} strokeWidth={1.75} strokeLinecap="round" />
      <Circle cx={12} cy={19} r={1.25} fill={color} />
    </Svg>
  );
}
