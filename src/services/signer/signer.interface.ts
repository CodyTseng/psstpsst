import type { Event, EventTemplate } from 'nostr-tools';

/**
 * Identity signing abstraction. Implementations:
 *   - NsecSigner   — local privkey from secure store
 *   - Nip46Signer  — remote bunker (Phase 2)
 *
 * PsstPsst services never reach inside; they only call these methods.
 * The DM encryption privkey is NOT a Signer — only the identity privkey is.
 */
export interface Signer {
  getPublicKey(): Promise<string>;
  signEvent(template: EventTemplate): Promise<Event>;
  /**
   * NIP-44 encrypt `plaintext` for `peerPubkey` using the identity key. Pass the
   * account's own pubkey to encrypt-to-self (e.g. NIP-51 private list content).
   * Optional: remote signers that don't expose NIP-44 may omit it.
   */
  nip44Encrypt?(peerPubkey: string, plaintext: string): Promise<string>;
  /** NIP-44 decrypt a ciphertext from `peerPubkey` using the identity key. */
  nip44Decrypt?(peerPubkey: string, ciphertext: string): Promise<string>;
  destroy?(): void | Promise<void>;
}
