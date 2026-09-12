export const NIP46_REQUEST_TIMEOUT_MS = 60_000;
export const NIP46_PAIRING_TIMEOUT_MS = 5 * 60_000;

export class Nip46TimeoutError extends Error {
  constructor(operation: string, timeoutMs: number) {
    super(`NIP-46 ${operation} timed out after ${Math.ceil(timeoutMs / 1_000)} seconds.`);
    this.name = 'Nip46TimeoutError';
  }
}

/** Bound a bunker round-trip while allowing the owner to cancel its underlying
 * subscription. The original promise is still observed after timeout so a late
 * rejection never becomes unhandled. */
export function withNip46Timeout<T>(
  promise: Promise<T>,
  operation: string,
  timeoutMs = NIP46_REQUEST_TIMEOUT_MS,
  onTimeout?: () => void,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      console.warn(
        `[nip46] ${operation} timed out after ${timeoutMs}ms at ${new Date().toISOString()}.`,
      );
      try {
        onTimeout?.();
      } catch {
        // Cleanup is best-effort; preserve the timeout as the request's error.
      } finally {
        reject(new Nip46TimeoutError(operation, timeoutMs));
      }
    }, timeoutMs);

    promise.then(
      (value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        resolve(value);
      },
      (error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        reject(error);
      },
    );
  });
}
