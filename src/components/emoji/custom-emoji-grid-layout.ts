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
  isElectron: boolean;
  touchColumns: number;
  desktopMinColumns: number;
  desktopMinCellSize: number;
  desktopMaxCellSize: number;
  desktopPreferredGap: number;
  cellPadding: number;
  imageLabelGap: number;
  captionLineHeight: number;
  verticalPadding: number;
};

export function calculateCustomEmojiGridLayout({
  containerWidth,
  horizontalPadding,
  isElectron,
  touchColumns,
  desktopMinColumns,
  desktopMinCellSize,
  desktopMaxCellSize,
  desktopPreferredGap,
  cellPadding,
  imageLabelGap,
  captionLineHeight,
  verticalPadding,
}: Input): CustomEmojiGridLayout {
  const availableWidth = Math.max(0, containerWidth - horizontalPadding * 2);
  const columns = isElectron
    ? Math.max(
        desktopMinColumns,
        Math.floor(
          (availableWidth + desktopPreferredGap) /
            (desktopMaxCellSize + desktopPreferredGap),
        ),
      )
    : touchColumns;
  const availableCellSize = Math.floor(
    (availableWidth - desktopPreferredGap * (columns - 1)) / columns,
  );
  const cellSize = isElectron
    ? Math.min(
        desktopMaxCellSize,
        Math.max(
          Math.min(desktopMinCellSize, availableWidth / columns),
          availableCellSize,
        ),
      )
    : desktopMaxCellSize;
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
