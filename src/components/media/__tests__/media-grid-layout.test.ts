import { mediaGridCellSize, mediaGridColumnCount } from '../media-grid-layout';

describe('media grid layout', () => {
  it('keeps three columns on compact widths', () => {
    expect(mediaGridColumnCount(390, 3, 144, 4)).toBe(3);
    expect(mediaGridCellSize(390, 3, 4)).toBe(127);
  });

  it('adds columns as the available content width grows', () => {
    expect(mediaGridColumnCount(600, 3, 144, 4)).toBe(4);
    expect(mediaGridColumnCount(900, 3, 144, 4)).toBe(6);
  });

  it('uses the compact desktop cell target independently of width', () => {
    expect(mediaGridColumnCount(900, 3, 128, 4)).toBe(6);
    expect(mediaGridColumnCount(1_200, 3, 128, 4)).toBe(9);
  });
});
