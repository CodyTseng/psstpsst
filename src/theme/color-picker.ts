import { hsvToHex } from '@/lib/color-picker';

/** Colour-space artwork, not application chrome or semantic status colours. */
export const colorPickerColors = {
  white: '#FFFFFF',
  black: '#000000',
  transparentWhite: 'rgba(255,255,255,0)',
  transparentBlack: 'rgba(0,0,0,0)',
  spectrum: ['#FF0000', '#FFFF00', '#00FF00', '#00FFFF', '#0000FF', '#FF00FF', '#FF0000'],
} as const;

export const colorPickerLayout = {
  areaAspectRatio: 1.2,
  areaMaxHeight: 320,
  trackThickness: 16,
  hueControlWidth: 40,
  thumbSize: 24,
  thumbBorder: 2,
  foregroundSwatchSize: 20,
  foregroundCheckSize: 12,
} as const;

/** Static angular colour wheel: compute its small artwork once, not per render. */
export const colorPickerWheelSegments = Array.from({ length: 72 }, (_, index) => {
  const start = index * Math.PI / 36;
  const end = (index + 1.1) * Math.PI / 36;
  const hue = index * 5;
  return {
    hue,
    color: hsvToHex({ h: hue, s: 1, v: 1 }),
    path: `M50 50 L${50 + 51 * Math.cos(start)} ${50 + 51 * Math.sin(start)} A51 51 0 0 1 ${50 + 51 * Math.cos(end)} ${50 + 51 * Math.sin(end)} Z`,
  };
});
