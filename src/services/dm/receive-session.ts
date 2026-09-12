import { createStore } from 'zustand/vanilla';

export type ReceiveSessionState =
  | { status: 'stopped'; accountPubkey: null }
  | { status: 'ready'; accountPubkey: string }
  | { status: 'key-required'; accountPubkey: string; encryptionPubkey: string };

/** Service-owned readiness, independent of mounted UI and the login pointer.
 * A key-required state survives ordinary teardown until a verified init succeeds. */
export const receiveSessionStore = createStore<ReceiveSessionState>()(() => ({
  status: 'stopped', accountPubkey: null,
}));

export class MessagingKeySyncRequiredError extends Error {
  constructor(readonly encryptionPubkey: string) {
    super('The current messaging encryption key must be synchronized before receiving messages.');
    this.name = 'MessagingKeySyncRequiredError';
  }
}
