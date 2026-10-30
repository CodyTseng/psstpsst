import { colorAtPosition, hexToHsv, hsvToHex } from '../color-picker';

it.each([
  ['#FF0000', 0], ['#FFFF00', 60], ['#00FF00', 120],
  ['#00FFFF', 180], ['#0000FF', 240], ['#FF00FF', 300],
] as const)('maps %s to hue %s', (hex, hue) => {
  expect(hexToHsv(hex)).toEqual({ h: hue, s: 1, v: 1 });
  expect(hsvToHex({ h: hue, s: 1, v: 1 })).toBe(hex);
});

it('round-trips RGB without colour drift', () => {
  for (const r of [0, 51, 128, 204, 255]) {
    for (const g of [0, 51, 128, 204, 255]) {
      for (const b of [0, 51, 128, 204, 255]) {
        const hex = '#' + [r, g, b].map((channel) => channel.toString(16).padStart(2, '0')).join('').toUpperCase();
        expect(hsvToHex(hexToHsv(hex))).toBe(hex);
      }
    }
  }
});

it('retains the chosen hue when entering grey or black', () => {
  expect(hexToHsv('#808080', 240).h).toBe(240);
  expect(hexToHsv('#000000', 180).h).toBe(180);
  expect(hsvToHex({ h: 360, s: 1, v: 1 })).toBe('#FF0000');
});

it('uses both plane axes and clamps drags beyond the control', () => {
  const initial = { h: 180, s: 1, v: 1 };
  expect(colorAtPosition(initial, false, 150, 75, 300, 150)).toEqual({ h: 180, s: 0.5, v: 0.5 });
  expect(colorAtPosition(initial, false, -40, 250, 300, 150)).toEqual({ h: 180, s: 0, v: 0 });
  expect(colorAtPosition(initial, true, 400, 0, 300, 40)).toEqual({ h: 360, s: 1, v: 1 });
  expect(colorAtPosition(initial, true, 0, 0, 0, 0)).toBe(initial);
});

it('maps the vertical hue rail from top to bottom and clamps outside drags', () => {
  const initial = { h: 0, s: 0.5, v: 0.75 };
  expect(colorAtPosition(initial, true, 20, 160, 40, 320, true)).toEqual({ h: 180, s: 0.5, v: 0.75 });
  expect(colorAtPosition(initial, true, 20, -50, 40, 320, true).h).toBe(0);
  expect(colorAtPosition(initial, true, 20, 400, 40, 320, true).h).toBe(360);
});
