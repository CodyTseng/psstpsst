import { nappletAdapter, nativeSurface } from '../napplet';
import { NAPPLET_FRAME_READY_MESSAGE } from '../../ports/napplet';

let mockExploreAvailable=false;
jest.mock('expo-modules-core', () => ({
  ...jest.requireActual('expo-modules-core'),
  requireOptionalNativeModule: () => ({ isAvailable: () => true, isExploreAvailable:()=>mockExploreAvailable, closeAsync: async () => {} }),
}));

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
  await expect(nappletAdapter.openPage!({url:'https://example.com',sourceId:'source',script:'',network:true})).rejects.toThrow('napplets.rebuild_required');
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
