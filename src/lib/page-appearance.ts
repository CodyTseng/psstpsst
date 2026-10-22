export type PageAppearance = { background: string; dark: boolean };

/** Restrict untrusted presentation hints to an opaque, normalized sRGB color. */
export function pageAppearance(value: unknown): PageAppearance | undefined {
  if (typeof value !== 'string' || !/^#[\da-f]{6}$/i.test(value)) return undefined;
  const channels = [1, 3, 5].map(offset => {
    const channel = parseInt(value.slice(offset, offset + 2), 16) / 255;
    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
  const luminance = channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
  return { background: value.toLowerCase(), dark: luminance < 0.179 };
}
