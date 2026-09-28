export type CustomEmojiGridLayout = {
  columns: number;
  cellSize: number;
  artworkSize: number;
  rowHeight: number;
  columnStep: number;
  gridPadding: number;
};

type Input = {
  containerWidth: number;
  horizontalPadding: number;
  minimumColumns: number;
  minimumCellSize: number;
  maximumCellSize: number;
  preferredGap: number;
  cellPadding: number;
  imageLabelGap: number;
  captionLineHeight: number;
  verticalPadding: number;
};

export function calculateCustomEmojiGridLayout({
  containerWidth,
  horizontalPadding,
  minimumColumns,
  minimumCellSize,
  maximumCellSize,
  preferredGap,
  cellPadding,
  imageLabelGap,
  captionLineHeight,
  verticalPadding,
}: Input): CustomEmojiGridLayout {
  const availableWidth = Math.max(0, containerWidth - horizontalPadding * 2);
  const columns = Math.max(
    minimumColumns,
    Math.floor((availableWidth + preferredGap) / (maximumCellSize + preferredGap)),
  );
  const availableCellSize = Math.floor(
    (availableWidth - preferredGap * (columns - 1)) / columns,
  );
  const cellSize = Math.min(
    maximumCellSize,
    Math.max(
      Math.min(minimumCellSize, availableWidth / columns),
      availableCellSize,
    ),
  );
  const rowHeight =
    cellSize +
    imageLabelGap +
    captionLineHeight +
    verticalPadding * 2;
  const columnStep =
    columns > 1 ? Math.max(0, (availableWidth - cellSize) / (columns - 1)) : 0;
  const artworkSize = Math.max(0, cellSize - cellPadding * 2);

  return {
    columns,
    cellSize,
    artworkSize,
    rowHeight,
    columnStep,
    gridPadding: horizontalPadding,
  };
}
