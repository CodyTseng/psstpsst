import { applicationChromeColors } from '../application-chrome';
import { darkPalette, lightPalette } from '../palette';
import { pageAppearance } from '@/lib/page-appearance';

function luminance(hex: string) {
  const channels = [1, 3, 5].map(offset => parseInt(hex.slice(offset, offset + 2), 16) / 255)
    .map(value => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
  return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
}

it('provides readable foregrounds across the full grayscale range and saturated backgrounds', () => {
  const colors = [...Array.from({ length: 256 }, (_, value) => `#${value.toString(16).padStart(2, '0').repeat(3)}`),
    '#ff0000', '#00ff00', '#0000ff', '#facc15', '#154c79'];
  for (const background of colors) {
    const appearance = pageAppearance(background)!;
    for (const host of [lightPalette, darkPalette]) {
      const chrome = applicationChromeColors(host, appearance);
      const a = luminance(background), b = luminance(chrome.text);
      expect((Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)).toBeGreaterThanOrEqual(4.5);
      expect(chrome.background).toBe(background);
      expect(chrome.surfaceMuted).toBe(background);
      expect(chrome.accent).toBe(host.accent);
    }
  }
});

it('returns the original host palette when a document has no validated appearance', () => {
  expect(applicationChromeColors(lightPalette)).toBe(lightPalette);
  expect(applicationChromeColors(darkPalette)).toBe(darkPalette);
});
