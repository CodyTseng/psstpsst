type Waiter = {
  resolve: () => void;
  reject: (error: Error) => void;
};

type Preparation =
  | { accountPubkey: string; status: 'preparing' }
  | { accountPubkey: string; status: 'ready' }
  | { accountPubkey: string; status: 'failed'; error: Error };

let preparation: Preparation | null = null;
const waiters = new Set<Waiter>();

function asError(error: unknown): Error {
  if (error instanceof Error) return error;
  if (typeof error === 'string' && error.trim()) return new Error(error.trim());
  return new Error('Messaging preparation failed.');
}

function rejectWaiters(error: Error): void {
  for (const waiter of waiters) waiter.reject(error);
  waiters.clear();
}

/** Start an account-scoped messaging preparation. Existing waiters survive a
 * restart for the same account, while an account switch cancels stale sends. */
export function beginMessagingSendPreparation(accountPubkey: string): void {
  if (preparation?.accountPubkey === accountPubkey && preparation.status === 'preparing') return;
  if (preparation?.accountPubkey !== accountPubkey) {
    rejectWaiters(new Error('The active account changed before the message could be sent.'));
  } else if (preparation?.status === 'failed') {
    rejectWaiters(preparation.error);
  }
  preparation = { accountPubkey, status: 'preparing' };
}

/** Release every send queued during startup once the account's DM session is usable. */
export function completeMessagingSendPreparation(accountPubkey: string): void {
  if (preparation?.accountPubkey !== accountPubkey) return;
  preparation = { accountPubkey, status: 'ready' };
  for (const waiter of waiters) waiter.resolve();
  waiters.clear();
}

/** Reject queued sends only for a terminal preparation failure. Transient
 * metadata unavailability retries before it reaches this boundary. */
export function failMessagingSendPreparation(accountPubkey: string, error: unknown): void {
  if (preparation?.accountPubkey !== accountPubkey) return;
  const reason = asError(error);
  preparation = { accountPubkey, status: 'failed', error: reason };
  rejectWaiters(reason);
}

/** Cancel pending sends when their account is no longer active. */
export function cancelMessagingSendPreparation(): void {
  preparation = null;
  rejectWaiters(new Error('The active account changed before the message could be sent.'));
}

/** Wait on one shared startup signal instead of polling from each composer. */
export function waitForMessagingSendReadiness(accountPubkey: string): Promise<void> {
  if (preparation?.accountPubkey !== accountPubkey) {
    return Promise.reject(new Error('DM service not initialized for this account'));
  }
  if (preparation.status === 'ready') return Promise.resolve();
  if (preparation.status === 'failed') return Promise.reject(preparation.error);
  return new Promise((resolve, reject) => {
    waiters.add({ resolve, reject });
  });
}
