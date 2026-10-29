import type { ElectronBridge } from '../bridge';
import { electronNappletAdapter } from '../napplet';

const fetchResource = jest.fn();
const cancel = jest.fn();

beforeEach(() => {
  fetchResource.mockReset();
  cancel.mockReset().mockResolvedValue(undefined);
  window.psstpsstDesktop = { napplet: { fetch: fetchResource, cancel } } as unknown as ElectronBridge;
});

afterEach(() => { delete window.psstpsstDesktop; });

it('forwards validators and decodes a conditional response', async () => {
  const fetchResponse = jest.fn(async () => ({ status: 304, bytes: '', etag: '"Tag"' }));
  window.psstpsstDesktop!.napplet.fetchResponse = fetchResponse as ElectronBridge['napplet']['fetchResponse'];
  await expect(electronNappletAdapter.fetchResourceResponse!('https://public.example/icon', 1024, undefined, { etag: '"Tag"' }))
    .resolves.toEqual({ status: 304, bytes: new Uint8Array(), etag: '"Tag"' });
  expect(fetchResponse).toHaveBeenCalledWith(expect.any(String), 'https://public.example/icon', 1024, { etag: '"Tag"' });
});

it('turns main-process lifecycle cancellation into an AbortError', async () => {
  fetchResource.mockResolvedValue(null);
  await expect(electronNappletAdapter.fetchResource('https://public.example/asset', 1024))
    .rejects.toMatchObject({ name: 'AbortError', message: 'session-closed' });
});

it('forwards renderer cancellation and rejects the cancelled result', async () => {
  let complete!: (result: null) => void;
  fetchResource.mockImplementation(() => new Promise(resolve => { complete = resolve; }));
  const controller = new AbortController();
  const result = electronNappletAdapter.fetchResource('https://public.example/asset', 1024, controller.signal);
  controller.abort();
  expect(cancel).toHaveBeenCalledWith(fetchResource.mock.calls[0][0]);
  complete(null);
  await expect(result).rejects.toMatchObject({ name: 'AbortError' });
});

it('decodes successful resource bytes', async () => {
  fetchResource.mockResolvedValue('AQID');
  await expect(electronNappletAdapter.fetchResource('https://public.example/asset', 1024))
    .resolves.toEqual(new Uint8Array([1, 2, 3]));
});

it('preserves genuine fetch failures', async () => {
  fetchResource.mockRejectedValue(new Error('resource-unavailable'));
  await expect(electronNappletAdapter.fetchResource('https://public.example/asset', 1024))
    .rejects.toThrow('resource-unavailable');
});

it.each([
  { error: 'ETIMEDOUT', code: 'ETIMEDOUT' },
  { error: 'blocked-by-policy' },
  { error: 'resource-unavailable' },
])('rejects serialized resource failures for caller fallback: $error', async failure => {
  fetchResource.mockResolvedValue(failure);
  await expect(electronNappletAdapter.fetchResource('https://public.example/asset', 1024))
    .rejects.toMatchObject({ message: failure.error, code: 'code' in failure ? failure.code : undefined });
});

it('routes progress only to its request and removes the listener on cancellation', async () => {
  let listener!: (id: string, progress: { received: number; total?: number }) => void;
  const unsubscribe = jest.fn();
  window.psstpsstDesktop!.napplet.onProgress = callback => { listener = callback; return unsubscribe; };
  let complete!: (result: null) => void;
  fetchResource.mockImplementation(() => new Promise(resolve => { complete = resolve; }));
  const controller = new AbortController(), progress = jest.fn();
  const result = electronNappletAdapter.fetchResource('https://public.example/app', 1024, controller.signal, { onProgress: progress });
  const id = fetchResource.mock.calls[0][0];
  listener('another-request', { received: 100 });
  listener(id, { received: 512, total: 1024 });
  expect(progress).toHaveBeenCalledTimes(1);
  expect(progress).toHaveBeenLastCalledWith({ received: 512, total: 1024 });
  controller.abort();
  listener(id, { received: 1024, total: 1024 });
  expect(progress).toHaveBeenCalledTimes(1);
  complete(null);
  await expect(result).rejects.toMatchObject({ name: 'AbortError' });
  expect(unsubscribe).toHaveBeenCalledTimes(1);
});
