export type MediaDimensions = { width: number; height: number };

export function validMediaDimensions(value: MediaDimensions): boolean {
  return Number.isSafeInteger(value.width) && value.width > 0 &&
    Number.isSafeInteger(value.height) && value.height > 0;
}

/** Accept only positive, finite integer dimensions from an upload descriptor. */
export function validMediaDim(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const match = value.match(/^(\d+)x(\d+)$/);
  if (!match) return undefined;
  const dimensions = { width: Number(match[1]), height: Number(match[2]) };
  return validMediaDimensions(dimensions) ? `${dimensions.width}x${dimensions.height}` : undefined;
}
