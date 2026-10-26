import type { Event, EventTemplate } from 'nostr-tools';

/** Account signing capability, independent of local vault or remote bunker transport. */
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
  /** Legacy NIP-04 operations use the identity key, never the messaging key. */
  nip04Encrypt?(peerPubkey: string, plaintext: string): Promise<string>;
  nip04Decrypt?(peerPubkey: string, ciphertext: string): Promise<string>;
  /** Release this instance or consumer lease; never delete saved credentials. */
  destroy?(): void | Promise<void>;
}
