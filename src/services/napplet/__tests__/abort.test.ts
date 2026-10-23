import { AbortController as NativeAbortController } from 'abort-controller';
import { assertNotAborted, linkAbort } from '@/platform/abort';

test('cancellation works with React Native signals without modern browser helpers', () => {
  const original = global.AbortController;
  global.AbortController = NativeAbortController as unknown as typeof AbortController;
  try {
    const first = new NativeAbortController();
    const second = new NativeAbortController();
    const linked = linkAbort([first.signal, second.signal] as unknown as AbortSignal[]);
    expect(() => assertNotAborted(linked.signal)).not.toThrow();
    second.abort();
    expect(linked.signal.aborted).toBe(true);
    expect(() => assertNotAborted(linked.signal)).toThrow('session-closed');
    linked.dispose();
    const alreadyClosed = linkAbort([second.signal] as unknown as AbortSignal[]);
    expect(alreadyClosed.signal.aborted).toBe(true);
    alreadyClosed.dispose();
  } finally {
    global.AbortController = original;
  }
});
