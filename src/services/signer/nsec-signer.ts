import { finalizeEvent, getPublicKey, type Event, type EventTemplate } from 'nostr-tools';
import * as nip04 from 'nostr-tools/nip04';

import { nip44Decrypt, nip44Encrypt } from '../crypto/nip44';
import { clearConversationKeys } from '../crypto/conversation-key-cache';
import type { Signer } from './signer.interface';

type SignerState = { destroyed: boolean; privkey: Uint8Array };

// Keep secrets off instances even when Babel lowers private fields to properties.
const states = new WeakMap<NsecSigner, SignerState>();

function checkedState(signer: NsecSigner): SignerState {
  const state = states.get(signer);
  if (!state || state.destroyed) throw new Error('Signer has been destroyed');
  return state;
}

export class NsecSigner implements Signer {
  constructor(privkey: Uint8Array) {
    states.set(this, { destroyed: false, privkey: new Uint8Array(privkey) });
  }

  async getPublicKey(): Promise<string> {
    return getPublicKey(checkedState(this).privkey);
  }

  async signEvent(template: EventTemplate): Promise<Event> {
    return finalizeEvent(template, checkedState(this).privkey);
  }

  async nip44Encrypt(peerPubkey: string, plaintext: string): Promise<string> {
    const result = await nip44Encrypt(plaintext, checkedState(this).privkey, peerPubkey);
    checkedState(this);
    return result;
  }

  async nip44Decrypt(peerPubkey: string, ciphertext: string): Promise<string> {
    const result = await nip44Decrypt(ciphertext, checkedState(this).privkey, peerPubkey);
    checkedState(this);
    return result;
  }

  async nip04Encrypt(peerPubkey: string, plaintext: string): Promise<string> {
    await new Promise<void>(resolve => setTimeout(resolve, 0));
    const result = await nip04.encrypt(checkedState(this).privkey, peerPubkey, plaintext);
    checkedState(this);
    return result;
  }

  async nip04Decrypt(peerPubkey: string, ciphertext: string): Promise<string> {
    await new Promise<void>(resolve => setTimeout(resolve, 0));
    const result = await nip04.decrypt(checkedState(this).privkey, peerPubkey, ciphertext);
    checkedState(this);
    return result;
  }

  async destroy(): Promise<void> {
    const state = states.get(this);
    if (!state) return;
    state.destroyed = true;
    clearConversationKeys(state.privkey);
    state.privkey.fill(0);
  }
}
