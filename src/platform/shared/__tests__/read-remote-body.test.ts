import { readRemoteBody } from '../read-remote-body';

function response(chunks: number[][], range?: string) {
  const read = jest.fn();
  for (const chunk of chunks) read.mockResolvedValueOnce({ done: false, value: Uint8Array.from(chunk) });
  read.mockResolvedValueOnce({ done: true });
  const releaseLock = jest.fn();
  return { value: {
    status: range ? 206 : 200,
    headers: { get: (key: string) => key === 'content-range' ? range : '4' },
    body: { getReader: () => ({ read, releaseLock }) },
  } as unknown as Response, read, releaseLock };
}

it('reports progress while consuming the body and assembles bytes in order', async () => {
  const stream = response([[1, 2], [3, 4]]);
  const progress = jest.fn();
  expect(await readRemoteBody(stream.value, progress)).toEqual(Uint8Array.of(1, 2, 3, 4));
  expect(progress).toHaveBeenCalledWith(2, 4);
  expect(progress).toHaveBeenLastCalledWith(4, 4);
  expect(stream.releaseLock).toHaveBeenCalledTimes(1);
});

it('reports absolute byte positions for range responses', async () => {
  const stream = response([[5, 6], [7, 8]], 'bytes 4-7/8');
  const progress = jest.fn();
  await readRemoteBody(stream.value, progress);
  expect(progress).toHaveBeenCalledWith(6, 8);
  expect(progress).toHaveBeenLastCalledWith(8, 8);
});

it('propagates a cancelled stream and releases its reader', async () => {
  const stream = response([]);
  const error = Object.assign(new Error('cancelled'), { name: 'AbortError' });
  stream.read.mockReset().mockRejectedValueOnce(error);
  await expect(readRemoteBody(stream.value, jest.fn())).rejects.toBe(error);
  expect(stream.releaseLock).toHaveBeenCalledTimes(1);
});
