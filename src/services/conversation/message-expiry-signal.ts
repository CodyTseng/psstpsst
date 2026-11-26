const listeners = new Set<(accountPubkey: string) => void>();

export function subscribeToStoredMessageExpiry(listener: (accountPubkey: string) => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function signalStoredMessageExpiry(accountPubkey: string): void {
  for (const listener of listeners) listener(accountPubkey);
}
