import { trayUnreadSvg, trayUnreadTitle } from '../tray-unread-icon';

describe('Electron tray unread icon', () => {
  it('adds a narrow gap before the native macOS count title', () => {
    expect(trayUnreadTitle(1)).toBe('\u20091');
    expect(trayUnreadTitle(120)).toBe('\u200999+');
    expect(trayUnreadTitle(0)).toBe('');
  });

  it('renders the shared capped count as a monochrome glyph', () => {
    const svg = trayUnreadSvg(120, 32);
    expect(svg).toContain('width="32"');
    expect(svg).toContain('fill="#000"');
    expect(svg).toContain('fill="#fff"');
    expect(svg).toContain('>99+</text>');
    expect(svg).not.toContain('>120</text>');
  });
});
