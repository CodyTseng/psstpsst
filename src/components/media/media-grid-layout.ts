/** Keep gallery cells near the runtime density target as the content pane resizes. */
export function mediaGridColumnCount(
  width: number,
  minColumns: number,
  minCellSize: number,
  gap: number,
): number {
  if (!Number.isFinite(width) || width <= 0) return minColumns;
  return Math.max(minColumns, Math.floor((width + gap) / (minCellSize + gap)));
}

export function mediaGridCellSize(width: number, columns: number, gap: number): number {
  if (!Number.isFinite(width) || width <= 0) return 0;
  return Math.max(1, Math.floor((width - gap * (columns - 1)) / columns));
}
