import { isAbortError, throwIfAborted } from '@/lib/async/abort';

export type NearbyFileSourceResult<T> =
  | { ok: true; source: 'network' | 'bluetooth'; value: T }
  | { ok: false; networkError: unknown; bluetoothError: unknown };

/** Try remote ciphertext first, then fall back to authenticated Nearby plaintext. */
export async function fetchNearbyNetworkFirst<T>(opts: {
  network: () => Promise<T>;
  bluetooth: () => Promise<T>;
  signal?: AbortSignal;
}): Promise<NearbyFileSourceResult<T>> {
  throwIfAborted(opts.signal);
  let networkError: unknown;
  try {
    const value = await opts.network();
    throwIfAborted(opts.signal);
    return { ok: true, source: 'network', value };
  } catch (error) {
    if (isAbortError(error)) throw error;
    // A native Nearby transfer reports its own cancellation error. Prefer the
    // caller's abort signal so a user pause never becomes a source failure.
    throwIfAborted(opts.signal);
    networkError = error;
  }

  try {
    const value = await opts.bluetooth();
    throwIfAborted(opts.signal);
    return { ok: true, source: 'bluetooth', value };
  } catch (bluetoothError) {
    if (isAbortError(bluetoothError)) throw bluetoothError;
    throwIfAborted(opts.signal);
    return { ok: false, networkError, bluetoothError };
  }
}
