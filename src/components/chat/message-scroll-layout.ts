/** RN Web converts this dataSet key to the corresponding DOM attribute. */
export const MESSAGE_CELL_DATA_KEY = 'psstpsstMessageId';
export const MESSAGE_CELL_ATTRIBUTE = 'data-psstpsst-message-id';

type Rect = { top: number; height: number };
type Cell = { getAttribute(name: string): string | null; getBoundingClientRect(): Rect };
type ScrollRoot = {
  scrollTop: number;
  scrollHeight: number;
  clientHeight: number;
  getBoundingClientRect(): Rect;
  querySelectorAll(selector: string): Iterable<Cell>;
};

/** Use actual transformed DOM geometry for an inverted list. Moving its scroll
 * offset forward moves the cell downward on screen. Insets exclude the title
 * and composer; oversized cells reveal their beginning instead of their middle. */
export function measureMessageScrollOffset(
  candidate: unknown,
  id: string,
  viewPosition: number,
  topInset: number,
  bottomInset: number,
) {
  const node = candidate as ScrollRoot | null | undefined;
  if (!node || typeof node.querySelectorAll !== 'function' ||
      typeof node.getBoundingClientRect !== 'function' || node.clientHeight <= 0) return null;
  for (const cell of node.querySelectorAll(`[${MESSAGE_CELL_ATTRIBUTE}]`)) {
    if (cell.getAttribute(MESSAGE_CELL_ATTRIBUTE) !== id) continue;
    const viewport = node.getBoundingClientRect();
    const target = cell.getBoundingClientRect();
    const visibleTop = viewport.top + Math.max(0, topInset);
    const visibleHeight = node.clientHeight - Math.max(0, topInset) - Math.max(0, bottomInset);
    if (target.height <= 0 || visibleHeight <= 0 ||
        ![target.top, target.height, visibleTop, visibleHeight, node.scrollTop].every(Number.isFinite)) return null;
    const desiredTop = visibleTop + Math.max(0, visibleHeight - target.height) * (1 - viewPosition);
    const offset = Math.max(0, Math.min(
      node.scrollTop + desiredTop - target.top,
      Math.max(0, node.scrollHeight - node.clientHeight),
    ));
    return { offset, currentOffset: node.scrollTop, targetTop: target.top, targetHeight: target.height, visibleTop, visibleHeight };
  }
  return null;
}
