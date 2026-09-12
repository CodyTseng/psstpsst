import { calculateCustomEmojiGridLayout } from '../custom-emoji-grid-layout';

function resolveCustomEmojiGridLayout(
  containerWidth: number,
  horizontalPadding: number,
  isElectron: boolean,
) {
  const cellPadding = 6;
  return calculateCustomEmojiGridLayout({
    containerWidth,
    horizontalPadding: Math.max(0, horizontalPadding - cellPadding),
    isElectron,
    touchColumns: 4,
    desktopMinColumns: 5,
    desktopMinCellSize: 60,
    desktopMaxCellSize: 76,
    desktopPreferredGap: 8,
    cellPadding,
    imageLabelGap: 4,
    captionLineHeight: 18,
    verticalPadding: 3,
  });
}

describe('custom emoji grid layout', () => {
  it('keeps the four-column touch layout', () => {
    const layout = resolveCustomEmojiGridLayout(390, 16, false);

    expect(layout.columns).toBe(4);
    expect(layout.cellSize).toBe(76);
    expect(layout.artworkSize).toBe(64);
    expect(layout.gridPadding).toBe(10);
    expect(layout.gridPadding + layout.columnStep * 3 + layout.cellSize).toBe(380);
    expect(layout.gridPadding + (layout.cellSize - layout.artworkSize) / 2).toBe(16);
  });

  it('uses five resized columns in a compact Electron picker', () => {
    const layout = resolveCustomEmojiGridLayout(360, 8, true);

    expect(layout.columns).toBe(5);
    expect(layout.cellSize).toBe(64);
    expect(layout.artworkSize).toBe(52);
    expect(layout.gridPadding).toBe(2);
    expect(layout.gridPadding + layout.columnStep * 4 + layout.cellSize).toBe(358);
    expect(layout.gridPadding + (layout.cellSize - layout.artworkSize) / 2).toBe(8);
  });

  it('adds columns while keeping artwork bounded on a wide Electron page', () => {
    const layout = resolveCustomEmojiGridLayout(720, 16, true);

    expect(layout.columns).toBe(8);
    expect(layout.cellSize).toBe(76);
    expect(layout.artworkSize).toBe(64);
    expect(layout.gridPadding).toBe(10);
    expect(layout.gridPadding + layout.columnStep * 7 + layout.cellSize).toBe(710);
    expect(layout.gridPadding + (layout.cellSize - layout.artworkSize) / 2).toBe(16);
  });
});
