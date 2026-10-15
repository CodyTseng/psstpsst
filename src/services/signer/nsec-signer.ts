import { finalizeEvent, getPublicKey, type Event, type EventTemplate } from 'nostr-tools';

import { nip44Decrypt, nip44Encrypt } from '../crypto/nip44';
import type { Signer } from './signer.interface';

export class NsecSigner implements Signer {
  private destroyed = false;
  constructor(private readonly privkey: Uint8Array) {}

  private check(): void {
    if (this.destroyed) throw new Error('Signer has been destroyed');
  }

  async getPublicKey(): Promise<string> {
    this.check();
    return getPublicKey(this.privkey);
  }

  async signEvent(template: EventTemplate): Promise<Event> {
    this.check();
    return finalizeEvent(template, this.privkey);
  }

  async nip44Encrypt(peerPubkey: string, plaintext: string): Promise<string> {
    this.check();
    return await nip44Encrypt(plaintext, this.privkey, peerPubkey);
  }

  async nip44Decrypt(peerPubkey: string, ciphertext: string): Promise<string> {
    this.check();
    return await nip44Decrypt(ciphertext, this.privkey, peerPubkey);
  }

  async destroy(): Promise<void> {
    this.destroyed = true;
    this.privkey.fill(0);
  }
}
