import { formatBadgeCount } from '../src/lib/badge-count';

/** Native macOS tray titles have no spacing option; add one narrow visual gap. */
export function trayUnreadTitle(count: number): string {
  if (count <= 0) return '';
  return `\u2009${formatBadgeCount(count)}`;
}

/** Render a compact monochrome count glyph for trays that cannot show a title. */
export function trayUnreadSvg(count: number, size: number): string {
  const label = formatBadgeCount(count);
  const fontSize = size * (label.length === 1 ? 0.66 : label.length === 2 ? 0.54 : 0.42);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}"><circle cx="${size / 2}" cy="${size / 2}" r="${size / 2 - 1}" fill="#000"/><text x="50%" y="50%" fill="#fff" font-family="sans-serif" font-size="${fontSize}" font-weight="700" text-anchor="middle" dominant-baseline="central">${label}</text></svg>`;
}
