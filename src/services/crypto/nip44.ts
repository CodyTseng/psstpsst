import { nip44 } from 'nostr-tools';

import { getConversationKeyAsync } from './conversation-key-cache';

export async function nip44Encrypt(
  plaintext: string,
  senderPrivkey: Uint8Array,
  recipientPubkey: string,
): Promise<string> {
  const conversationKey = await getConversationKeyAsync(senderPrivkey, recipientPubkey, {
    cache: true,
  });
  return nip44.v2.encrypt(plaintext, conversationKey);
}

export async function nip44Decrypt(
  ciphertext: string,
  recipientPrivkey: Uint8Array,
  senderPubkey: string,
): Promise<string> {
  const conversationKey = await getConversationKeyAsync(recipientPrivkey, senderPubkey, {
    cache: true,
  });
  return nip44.v2.decrypt(ciphertext, conversationKey);
}
