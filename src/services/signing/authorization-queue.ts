import { assertNotAborted, linkAbort } from '@/platform/abort';
import type { SigningAccountScope } from './repository';

type Entry = { started: boolean; run(): Promise<void>; cleanup(): void };
type Queue = { entries: Entry[]; running: boolean };
const queues = new Map<string, Queue>();

async function drain(key: string, queue: Queue): Promise<void> {
  if (queue.running) return;
  queue.running = true;
  try {
    while (queue.entries.length) {
      const entry = queue.entries[0];
      entry.started = true;
      await entry.run();
      queue.entries.shift();
      entry.cleanup();
    }
  } finally {
    queue.running = false;
    if (!queue.entries.length && queues.get(key) === queue) queues.delete(key);
  }
}

/** Recheck authority only after the preceding decision for this source has committed. */
export function queueAuthorization<T>(scope: SigningAccountScope, signals: readonly AbortSignal[], task: () => Promise<T>): Promise<T> {
  const linked = linkAbort(signals);
  const key = JSON.stringify([scope.accountPubkey, scope.sourceId]);
  const queue: Queue = queues.get(key) ?? { entries: [], running: false };
  if (linked.signal.aborted || queue.entries.length >= 16) {
    linked.dispose();
    try { assertNotAborted(linked.signal); } catch (error) { return Promise.reject(error); }
    return Promise.reject(new Error('quota-exceeded'));
  }
  return new Promise<T>((resolve, reject) => {
    const cleanup = () => { linked.signal.removeEventListener('abort', abort); linked.dispose(); };
    const entry: Entry = {
      started: false, cleanup,
      async run() {
        try {
          assertNotAborted(linked.signal);
          const value = await task();
          assertNotAborted(linked.signal);
          resolve(value);
        } catch (error) { reject(error); }
      },
    };
    const abort = () => {
      if (!entry.started) {
        const index = queue.entries.indexOf(entry);
        if (index >= 0) queue.entries.splice(index, 1);
        if (!queue.running && !queue.entries.length && queues.get(key) === queue) queues.delete(key);
      }
      cleanup();
      try { assertNotAborted(linked.signal); } catch (error) { reject(error); }
    };
    queue.entries.push(entry);
    queues.set(key, queue);
    linked.signal.addEventListener('abort', abort, { once: true });
    if (linked.signal.aborted) abort();
    else void drain(key, queue);
  });
}
