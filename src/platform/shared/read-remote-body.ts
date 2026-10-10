/** Read a response once, reporting streamed bytes without repeatedly concatenating them. */
export async function readRemoteBody(
  response: Response,
  onProgress?: (receivedBytes: number, totalBytes: number) => void,
): Promise<Uint8Array> {
  if (!onProgress || !response.body) return new Uint8Array(await response.arrayBuffer());
  const range = response.status === 206
    ? response.headers.get('content-range')?.match(/^bytes (\d+)-\d+\/(\d+)$/)
    : null;
  const start = range ? Number(range[1]) : 0;
  const total = range ? Number(range[2]) : Number(response.headers.get('content-length')) || 0;
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;
  let lastReport = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      received += value.length;
      const now = Date.now();
      if (now - lastReport >= 100) {
        onProgress(start + received, total);
        lastReport = now;
      }
    }
    onProgress(start + received, total || start + received);
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(received);
  let offset = 0;
  let yieldAt = 4 * 1024 * 1024;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
    if (offset >= yieldAt) {
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
      yieldAt = offset + 4 * 1024 * 1024;
    }
  }
  return bytes;
}
