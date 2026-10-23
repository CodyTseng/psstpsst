/** React Native's AbortSignal does not implement the newer browser static helpers. */
export function assertNotAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    const error = new Error('session-closed');
    error.name = 'AbortError';
    throw error;
  }
}

export function linkAbort(signals: readonly AbortSignal[]) {
  const controller = new AbortController();
  const abort = () => controller.abort();
  for (const signal of signals) {
    if (signal.aborted) controller.abort();
    else signal.addEventListener('abort', abort, { once: true });
  }
  return {
    signal: controller.signal,
    dispose: () => {
      for (const signal of signals) signal.removeEventListener('abort', abort);
    },
  };
}
