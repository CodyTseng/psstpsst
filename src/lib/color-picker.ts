export type HSV = { h: number; s: number; v: number };

export function clampUnit(value: number): number {
  'worklet';
  return Math.max(0, Math.min(1, value));
}

/** Keep hue independently: grey and black have no recoverable RGB hue. */
export function hexToHsv(hex: string, fallbackHue = 0): HSV {
  const [r, g, b] = [1, 3, 5].map((offset) => parseInt(hex.slice(offset, offset + 2), 16) / 255);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;
  let h = fallbackHue;
  if (delta > 0) {
    h = max === r ? ((g - b) / delta) % 6 : max === g ? (b - r) / delta + 2 : (r - g) / delta + 4;
    h = (h * 60 + 360) % 360;
  }
  return { h, s: max === 0 ? 0 : delta / max, v: max };
}

export function hsvToHex({ h, s, v }: HSV): `#${string}` {
  'worklet';
  const hue = ((h % 360) + 360) % 360 / 60;
  const chroma = clampUnit(v) * clampUnit(s);
  const x = chroma * (1 - Math.abs(hue % 2 - 1));
  const m = clampUnit(v) - chroma;
  const channels = hue < 1 ? [chroma, x, 0] : hue < 2 ? [x, chroma, 0]
    : hue < 3 ? [0, chroma, x] : hue < 4 ? [0, x, chroma]
      : hue < 5 ? [x, 0, chroma] : [chroma, 0, x];
  return `#${channels.map((channel) => Math.round((channel + m) * 255).toString(16).padStart(2, '0')).join('').toUpperCase()}`;
}

/** Physical colour-space axes stay left-to-right independently of UI locale. */
export function colorAtPosition(current: HSV, hueOnly: boolean, x: number, y: number, width: number, height: number, verticalHue = false): HSV {
  'worklet';
  if (width <= 0 || height <= 0) return current;
  return hueOnly
    ? { ...current, h: clampUnit(verticalHue ? y / height : x / width) * 360 }
    : { ...current, s: clampUnit(x / width), v: 1 - clampUnit(y / height) };
}
