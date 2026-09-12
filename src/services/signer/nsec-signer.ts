import { finalizeEvent, getPublicKey, type Event, type EventTemplate } from 'nostr-tools';

import { nip44Decrypt, nip44Encrypt } from '../crypto/nip44';
import type { Signer } from './signer.interface';

export class NsecSigner implements Signer {
  constructor(private readonly privkey: Uint8Array) {}

  async getPublicKey(): Promise<string> {
    return getPublicKey(this.privkey);
  }

  async signEvent(template: EventTemplate): Promise<Event> {
    return finalizeEvent(template, this.privkey);
  }

  async nip44Encrypt(peerPubkey: string, plaintext: string): Promise<string> {
    return await nip44Encrypt(plaintext, this.privkey, peerPubkey);
  }

  async nip44Decrypt(peerPubkey: string, ciphertext: string): Promise<string> {
    return await nip44Decrypt(ciphertext, this.privkey, peerPubkey);
  }
}
