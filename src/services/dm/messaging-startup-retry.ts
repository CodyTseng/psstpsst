import { platform } from '@/platform';

import {
  MessagingMetadataUnavailableError,
  resolveMessagingMetadata,
} from './messaging-metadata';

const RETRY_DELAYS_MS = [1_000, 2_000, 5_000, 10_000, 30_000, 60_000];
const networkWaiters = new Set<() => void>();
let networkObserved = false;

/** The network port has process-lifetime listeners. Register once and keep only
 * active waits in the dispatch set, rather than leaking a listener per retry. */
function observeNetwork(): void {
  if (networkObserved) return;
  networkObserved = true;
  platform.networkState.addStateListener((state) => {
    if (state.isConnected === false || state.isInternetReachable === false) return;
    for (const wake of [...networkWaiters]) wake();
  });
}

function waitForRetry(delayMs: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.resolve();
  observeNetwork();
  return new Promise((resolve) => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const finish = () => {
      if (timer) clearTimeout(timer);
      networkWaiters.delete(finish);
      removeAppStateListener();
      signal.removeEventListener('abort', finish);
      resolve();
    };
    const removeAppStateListener = platform.appState.addChangeListener((state) => {
      if (state === 'active') finish();
      else if (timer) {
        clearTimeout(timer);
        timer = null;
      }
    });
    networkWaiters.add(finish);
    signal.addEventListener('abort', finish, { once: true });
    // A suspended mobile timer must not be the only way to resume preparation.
    // Background polling has its own bounded task and never calls this helper.
    if (platform.appState.currentState() === 'active') timer = setTimeout(finish, delayMs);
  });
}

/** Retry only unavailable metadata reads. Successful refresh still precedes
 * key reconciliation and intake; invalid metadata/storage errors stay visible. */
export async function resolveMessagingMetadataForStartup(
  accountPubkey: string,
  options: Parameters<typeof resolveMessagingMetadata>[1] & { abort: AbortSignal },
) {
  for (let attempt = 0; !options.abort.aborted; attempt++) {
    try {
      return await resolveMessagingMetadata(accountPubkey, options);
    } catch (error) {
      if (options.abort.aborted || !(error instanceof MessagingMetadataUnavailableError)) throw error;
      if (attempt === 0) {
        console.warn('[boot] Messaging metadata unavailable; waiting to retry.', error);
      }
      await waitForRetry(RETRY_DELAYS_MS[Math.min(attempt, RETRY_DELAYS_MS.length - 1)], options.abort);
    }
  }
  throw new Error('Messaging preparation was cancelled.');
}
