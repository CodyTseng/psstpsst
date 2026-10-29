import { nappletAdapter, nativeSurface } from '../napplet';
import { NAPPLET_FRAME_READY_MESSAGE } from '../../ports/napplet';

let mockExploreAvailable=false;
const mockResourceResponse = jest.fn();
const mockFetchResource = jest.fn();
const mockAddListener = jest.fn();
const mockCancelResource = jest.fn(async () => {});
jest.mock('expo-modules-core', () => ({
  ...jest.requireActual('expo-modules-core'),
  requireOptionalNativeModule: () => ({ isAvailable: () => true, isExploreAvailable:()=>mockExploreAvailable, closeAsync: async () => {},
    supportsResourceHeaders: () => true, supportsResourceProgress: () => true, addListener: mockAddListener,
    fetchResourceAsync: (...args: unknown[]) => mockFetchResource(...args),
    fetchResourceResponseAsync: (...args: unknown[]) => mockResourceResponse(...args), cancelResourceAsync: mockCancelResource }),
}));

it('returns native conditional response headers without changing validator case', async () => {
  mockResourceResponse.mockResolvedValueOnce({ status: 304, bytes: '', etag: '"MixedCase"' });
  await expect(nappletAdapter.fetchResourceResponse!('https://site.example/icon', 1024, undefined, { etag: '"MixedCase"' }))
    .resolves.toEqual({ status: 304, bytes: new Uint8Array(), etag: '"MixedCase"' });
  expect(mockResourceResponse).toHaveBeenCalledWith(expect.any(String), 'https://site.example/icon', 1024, '"MixedCase"', undefined);
});

it('keeps a mounted surface hidden until its own first frame and ignores late readiness', async () => {
  const first = await nappletAdapter.open('first');
  const second = await nappletAdapter.open('second');
  const changed = jest.fn();
  const message = jest.fn();
  const unsubscribe = nativeSurface.subscribe(changed);
  const stopListening = nappletAdapter.addMessageListener(message);
  try {
    expect(nativeSurface.get(first)?.ready).toBe(false);
    nativeSurface.message(first, NAPPLET_FRAME_READY_MESSAGE);
    expect(nativeSurface.get(first)?.ready).toBe(true);
    expect(nativeSurface.get(second)?.ready).toBe(false);
    expect(changed).toHaveBeenCalledTimes(1);
    expect(message).toHaveBeenCalledWith(first, NAPPLET_FRAME_READY_MESSAGE);
    nativeSurface.message(first, NAPPLET_FRAME_READY_MESSAGE);
    expect(changed).toHaveBeenCalledTimes(1);
    expect(message).toHaveBeenCalledTimes(1);
    await nappletAdapter.close(first);
    changed.mockClear();
    nativeSurface.message(first, NAPPLET_FRAME_READY_MESSAGE);
    expect(nativeSurface.get(first)).toBeUndefined();
    expect(changed).not.toHaveBeenCalled();
    nativeSurface.message(second, '{"type":"shell.ready"}');
    expect(message).toHaveBeenCalledWith(second, '{"type":"shell.ready"}');
    expect(nativeSurface.get(second)?.ready).toBe(false);
  } finally {
    unsubscribe(); stopListening();
    await nappletAdapter.close(first);
    await nappletAdapter.close(second);
  }
});

it('requires the new native Explore capability before opening a remote page',async()=>{
  await expect(nappletAdapter.openPage!({url:'https://example.com',sourceId:'source',script:'',network:true})).rejects.toThrow('applications.rebuild_required');
});

it('keeps Explore hidden until its document reports its first frame',async()=>{
  mockExploreAvailable=true;
  try {
    const id=await nappletAdapter.openPage!({url:'https://example.com',sourceId:'source',script:'',network:true});
    expect(nativeSurface.get(id)?.ready).toBe(false);
    nativeSurface.message(id,JSON.stringify({type:'explore.request',raw:JSON.stringify({method:'ready'})}));
    expect(nativeSurface.get(id)?.ready).toBe(true);
    await nappletAdapter.close(id);
  } finally {mockExploreAvailable=false;}
});

it('scopes native progress to its request and stops forwarding after cancellation', async () => {
  let listener!: (progress: { id: string; received: number; total?: number }) => void;
  const remove = jest.fn();
  mockAddListener.mockImplementation((_event, callback) => { listener = callback; return { remove }; });
  let complete!: (value: string) => void;
  mockFetchResource.mockImplementation(() => new Promise(resolve => { complete = resolve; }));
  const controller = new AbortController(), progress = jest.fn();
  const result = nappletAdapter.fetchResource('https://public.example/app', 1024, controller.signal, { onProgress: progress });
  const id = mockFetchResource.mock.calls.at(-1)![0];
  listener({ id: 'other', received: 100 });
  listener({ id, received: 512, total: 1024 });
  expect(progress).toHaveBeenCalledTimes(1);
  expect(progress).toHaveBeenLastCalledWith({ received: 512, total: 1024 });
  controller.abort();
  listener({ id, received: 1024, total: 1024 });
  expect(progress).toHaveBeenCalledTimes(1);
  expect(mockCancelResource).toHaveBeenLastCalledWith(id);
  complete('AQID');
  await expect(result).rejects.toMatchObject({ name: 'AbortError' });
  expect(remove).toHaveBeenCalledTimes(1);
});
