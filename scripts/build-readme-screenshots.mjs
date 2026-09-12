import { readFileSync, writeFileSync } from 'node:fs';

// Match the visible window's vertical placement in the desktop screenshots.
// Embed the original PNG so the SVG works as a standalone GitHub README image.
const directory = new URL('../docs/images/', import.meta.url);
const width = 1179;
const height = 2556;
const insetX = 120;
const insetY = 134;
const canvasWidth = width + insetX * 2;
const canvasHeight = 2946;
const radius = 86;

for (const theme of ['light', 'dark']) {
  const png = readFileSync(new URL(`mobile-${theme}.png`, directory));
  if (png.readUInt32BE(16) !== width || png.readUInt32BE(20) !== height) {
    throw new Error('Update the frame dimensions for the new mobile screenshot.');
  }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${canvasWidth}" height="${canvasHeight}" viewBox="0 0 ${canvasWidth} ${canvasHeight}">
  <title>PsstPsst on iOS in ${theme} mode</title>
  <defs>
    <clipPath id="screen">
      <rect x="${insetX}" y="${insetY}" width="${width}" height="${height}" rx="${radius}"/>
    </clipPath>
    <filter id="shadow" x="0" y="0" width="${canvasWidth}" height="${canvasHeight}" filterUnits="userSpaceOnUse" color-interpolation-filters="sRGB">
      <feGaussianBlur in="SourceAlpha" stdDeviation="36"/>
      <feOffset dy="38"/>
      <feComponentTransfer><feFuncA type="linear" slope="0.28"/></feComponentTransfer>
    </filter>
  </defs>
  <rect x="${insetX}" y="${insetY}" width="${width}" height="${height}" rx="${radius}" filter="url(#shadow)"/>
  <image x="${insetX}" y="${insetY}" width="${width}" height="${height}" clip-path="url(#screen)" xlink:href="data:image/png;base64,${png.toString('base64')}"/>
</svg>
`;
  writeFileSync(new URL(`mobile-${theme}-framed.svg`, directory), svg);
}
