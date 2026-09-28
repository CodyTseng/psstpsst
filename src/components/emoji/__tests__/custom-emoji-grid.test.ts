import { calculateCustomEmojiGridLayout } from '../custom-emoji-grid-layout';

function resolveCustomEmojiGridLayout(
  containerWidth: number,
  horizontalPadding: number,
  isElectron: boolean,
) {
  const cellPadding = 4;
  return calculateCustomEmojiGridLayout({
    containerWidth,
    horizontalPadding: Math.max(0, horizontalPadding - cellPadding),
    minimumColumns: isElectron ? 5 : 4,
    minimumCellSize: 48 + cellPadding * 2,
    maximumCellSize: 68 + cellPadding * 2,
    preferredGap: 4,
    cellPadding,
    imageLabelGap: 4,
    captionLineHeight: 18,
    verticalPadding: 3,
  });
}

describe('custom emoji grid layout', () => {
  it('keeps four full-size columns in a typical touch layout', () => {
    const layout = resolveCustomEmojiGridLayout(390, 16, false);

    expect(layout.columns).toBe(4);
    expect(layout.cellSize).toBe(76);
    expect(layout.artworkSize).toBe(68);
    expect(layout.gridPadding).toBe(12);
    expect(layout.gridPadding + layout.columnStep * 3 + layout.cellSize).toBe(378);
    expect(layout.gridPadding + (layout.cellSize - layout.artworkSize) / 2).toBe(16);
  });

  it('adds columns to use the width of a wide touch layout', () => {
    const layout = resolveCustomEmojiGridLayout(720, 16, false);

    expect(layout.columns).toBe(8);
    expect(layout.cellSize).toBe(76);
    expect(layout.artworkSize).toBe(68);
    expect(layout.gridPadding).toBe(12);
    expect(layout.gridPadding + layout.columnStep * 7 + layout.cellSize).toBe(708);
    expect(layout.gridPadding + (layout.cellSize - layout.artworkSize) / 2).toBe(16);
  });

  it('shrinks cells to fit a narrow touch layout', () => {
    const layout = resolveCustomEmojiGridLayout(320, 16, false);

    expect(layout.columns).toBe(4);
    expect(layout.cellSize).toBe(71);
    expect(layout.artworkSize).toBe(63);
    expect(layout.gridPadding + layout.columnStep * 3 + layout.cellSize).toBe(308);
  });

  it('uses five larger, tighter columns in the Electron picker', () => {
    const layout = resolveCustomEmojiGridLayout(400, 8, true);

    expect(layout.columns).toBe(5);
    expect(layout.cellSize).toBe(75);
    expect(layout.artworkSize).toBe(67);
    expect(layout.gridPadding).toBe(4);
    expect(layout.columnStep - layout.cellSize).toBeCloseTo(4.25);
    expect(layout.gridPadding + layout.columnStep * 4 + layout.cellSize).toBe(396);
    expect(layout.gridPadding + (layout.cellSize - layout.artworkSize) / 2).toBe(8);
  });

  it('adds columns while keeping artwork bounded on a wide Electron page', () => {
    const layout = resolveCustomEmojiGridLayout(720, 16, true);

    expect(layout.columns).toBe(8);
    expect(layout.cellSize).toBe(76);
    expect(layout.artworkSize).toBe(68);
    expect(layout.gridPadding).toBe(12);
    expect(layout.gridPadding + layout.columnStep * 7 + layout.cellSize).toBe(708);
    expect(layout.gridPadding + (layout.cellSize - layout.artworkSize) / 2).toBe(16);
  });
});
