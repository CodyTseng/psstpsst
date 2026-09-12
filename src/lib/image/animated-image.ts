/** Detect a GIF even when a platform picker omits or decorates its MIME type. */
export function isAnimatedGifImage(
  mime?: string,
  fileName?: string,
  uri?: string,
): boolean {
  if (mime?.split(';', 1)[0].trim().toLowerCase() === 'image/gif') return true;
  return [fileName, uri?.split(/[?#]/, 1)[0]].some(
    (candidate) => candidate?.toLowerCase().endsWith('.gif') ?? false,
  );
}
