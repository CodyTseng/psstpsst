import { Transform } from 'node:stream';

/** Count uploaded bytes without putting the source stream into a lossy flowing mode. */
export function createUploadProgressTransform(
  totalBytes: number,
  onProgress?: (sentBytes: number, totalBytes: number) => void,
): Transform {
  let sentBytes = 0;
  return new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      sentBytes = Math.min(totalBytes, sentBytes + chunk.byteLength);
      onProgress?.(sentBytes, totalBytes);
      callback(null, chunk);
    },
  });
}
