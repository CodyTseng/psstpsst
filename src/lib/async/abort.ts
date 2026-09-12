export function createAbortError(message = 'Operation cancelled'): Error {
  const error = new Error(message);
  error.name = 'AbortError';
  return error;
}

export function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw createAbortError();
}

export function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}
