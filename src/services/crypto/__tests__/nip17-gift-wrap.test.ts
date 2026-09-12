import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools';

import {
  KIND_CHAT,
  KIND_REACTION,
  createGiftWrappedMessage,
  unwrapGiftWrap,
  unwrapGiftWrapWithKeys,
} from '../nip17-gift-wrap';

import * as conversationKeys from '../conversation-key-cache';

describe('NIP-17 gift wraps', () => {
  test('round-trips a unified proximity identity without duplicate routing tags', async () => {
    const senderSecret = generateSecretKey();
    const recipientSecret = generateSecretKey();
    const senderPubkey = getPublicKey(senderSecret);
    const recipientPubkey = getPublicKey(recipientSecret);

    const wrapped = await createGiftWrappedMessage({
      rumorTemplate: {
        kind: KIND_CHAT,
        content: 'hello nearby',
        tags: [['p', recipientPubkey]],
        created_at: 1_700_000_000,
      },
      senderIdentityPubkey: senderPubkey,
      senderEncPrivkey: senderSecret,
      senderEncPubkey: senderPubkey,
      recipientIdentityPubkey: recipientPubkey,
      recipientEncPubkey: recipientPubkey,
      signSeal: async (template) => finalizeEvent(template, senderSecret),
    });

    expect(wrapped.seal.tags).toEqual([]);
    expect(wrapped.giftWrap.tags).toEqual([['p', recipientPubkey]]);
    const result = await unwrapGiftWrap(wrapped.giftWrap, recipientSecret);
    expect(result?.rumor).toEqual(wrapped.rumor);
    expect(result?.senderEncryptionPubkey).toBe(senderPubkey);
  });

  test('keeps the relay split-key seal format compatible', async () => {
    const identitySecret = generateSecretKey();
    const encryptionSecret = generateSecretKey();
    const recipientIdentity = generateSecretKey();
    const recipientEncryption = generateSecretKey();
    const identityPubkey = getPublicKey(identitySecret);
    const encryptionPubkey = getPublicKey(encryptionSecret);
    const recipientIdentityPubkey = getPublicKey(recipientIdentity);
    const recipientEncryptionPubkey = getPublicKey(recipientEncryption);

    const wrapped = await createGiftWrappedMessage({
      rumorTemplate: {
        kind: KIND_CHAT,
        content: 'legacy-compatible',
        tags: [['p', recipientIdentityPubkey]],
        created_at: 1_700_000_001,
      },
      senderIdentityPubkey: identityPubkey,
      senderEncPrivkey: encryptionSecret,
      senderEncPubkey: encryptionPubkey,
      recipientIdentityPubkey,
      recipientEncPubkey: recipientEncryptionPubkey,
      signSeal: async (template) => finalizeEvent(template, identitySecret),
    });

    expect(wrapped.seal.tags).toContainEqual(['n', encryptionPubkey]);
    const result = await unwrapGiftWrap(wrapped.giftWrap, recipientEncryption);
    expect(result?.rumor.pubkey).toBe(identityPubkey);
    expect(result?.senderEncryptionPubkey).toBe(encryptionPubkey);
  });

  test('carries nearby replies and reactions inside the same gift-wrap envelope', async () => {
    const senderSecret = generateSecretKey();
    const recipientSecret = generateSecretKey();
    const senderPubkey = getPublicKey(senderSecret);
    const recipientPubkey = getPublicKey(recipientSecret);
    const targetId = 'ab'.repeat(32);

    for (const rumorTemplate of [
      {
        kind: KIND_CHAT,
        content: 'reply nearby',
        tags: [['p', recipientPubkey], ['e', targetId]],
        created_at: 1_700_000_003,
      },
      {
        kind: KIND_REACTION,
        content: '👍',
        tags: [['p', recipientPubkey], ['e', targetId]],
        created_at: 1_700_000_004,
      },
    ]) {
      const wrapped = await createGiftWrappedMessage({
        rumorTemplate,
        senderIdentityPubkey: senderPubkey,
        senderEncPrivkey: senderSecret,
        senderEncPubkey: senderPubkey,
        recipientIdentityPubkey: recipientPubkey,
        recipientEncPubkey: recipientPubkey,
        signSeal: async (template) => finalizeEvent(template, senderSecret),
      });

      const result = await unwrapGiftWrap(wrapped.giftWrap, recipientSecret);
      expect(result?.rumor.kind).toBe(rumorTemplate.kind);
      expect(result?.rumor.tags).toContainEqual(['e', targetId]);
    }
  });

  test('rejects an outer gift wrap with an invalid signature', async () => {
    const senderSecret = generateSecretKey();
    const recipientSecret = generateSecretKey();
    const senderPubkey = getPublicKey(senderSecret);
    const recipientPubkey = getPublicKey(recipientSecret);
    const wrapped = await createGiftWrappedMessage({
      rumorTemplate: { kind: KIND_CHAT, content: 'secure', tags: [['p', recipientPubkey]], created_at: 1_700_000_002 },
      senderIdentityPubkey: senderPubkey,
      senderEncPrivkey: senderSecret,
      senderEncPubkey: senderPubkey,
      recipientIdentityPubkey: recipientPubkey,
      recipientEncPubkey: recipientPubkey,
      signSeal: async (template) => finalizeEvent(template, senderSecret),
    });

    expect(
      await unwrapGiftWrap({ ...wrapped.giftWrap, content: `${wrapped.giftWrap.content}x` }, recipientSecret),
    ).toBeNull();
  });
});


/** Valid outer wrappers let each test exercise seal classification separately
 * from the inability to decrypt a wrapper addressed to a different key. */
async function splitKeyFixture(sealOptions: { tags?: string[][]; content?: string } = {}) {
  const identity = generateSecretKey();
  const encryption = generateSecretKey();
  const recipientIdentity = generateSecretKey();
  const recipientEncryption = generateSecretKey();
  const wrapped = await createGiftWrappedMessage({
    rumorTemplate: {
      kind: KIND_CHAT, content: 'split-key message',
      tags: [['p', getPublicKey(recipientIdentity)]], created_at: 1_700_000_010,
    },
    senderIdentityPubkey: getPublicKey(identity),
    senderEncPrivkey: encryption,
    senderEncPubkey: getPublicKey(encryption),
    recipientIdentityPubkey: getPublicKey(recipientIdentity),
    recipientEncPubkey: getPublicKey(recipientEncryption),
    signSeal: async (template) => finalizeEvent({ ...template, ...sealOptions }, identity),
  });
  return { wrapped, recipientEncryption, recipientIdentity };
}

describe('relay split-key intake', () => {
  test('decrypts supported messages with a retained older key', async () => {
    const { wrapped, recipientEncryption } = await splitKeyFixture();
    const result = await unwrapGiftWrapWithKeys(wrapped.giftWrap, [
      { privkey: generateSecretKey() }, { privkey: recipientEncryption },
    ]);
    expect(result.status).toBe('decrypted');
    if (result.status === 'decrypted') expect(result.value.rumor).toEqual(wrapped.rumor);
  });

  test('skips a seal without n before inner decryption or trying further keys', async () => {
    const { wrapped, recipientEncryption } = await splitKeyFixture({
      tags: [], content: 'content that must never be decrypted',
    });
    const derive = jest.spyOn(conversationKeys, 'getConversationKeyAsync');
    try {
      expect(await unwrapGiftWrapWithKeys(wrapped.giftWrap, [
        { privkey: recipientEncryption }, { privkey: generateSecretKey() },
      ])).toEqual({ status: 'unsupported', reason: 'missing-encryption-key-tag' });
      expect(derive).toHaveBeenCalledTimes(1);
      expect(derive).toHaveBeenCalledWith(recipientEncryption, wrapped.giftWrap.pubkey);
    } finally {
      derive.mockRestore();
    }
  });

  test('reports supported seals with failed inner decryption as failures', async () => {
    const { wrapped, recipientEncryption } = await splitKeyFixture({ content: 'invalid ciphertext' });
    expect(await unwrapGiftWrapWithKeys(wrapped.giftWrap, [{ privkey: recipientEncryption }]))
      .toEqual({ status: 'failed' });
  });

  test('does not classify a present but empty n tag as ordinary NIP-17', async () => {
    const { wrapped, recipientEncryption } = await splitKeyFixture({ tags: [['n']] });
    expect(await unwrapGiftWrapWithKeys(wrapped.giftWrap, [{ privkey: recipientEncryption }]))
      .toEqual({ status: 'failed' });
  });

  test('cannot classify a seal when the outer wrap is unreadable', async () => {
    const { wrapped } = await splitKeyFixture({ tags: [] });
    expect(await unwrapGiftWrapWithKeys(wrapped.giftWrap, [{ privkey: generateSecretKey() }]))
      .toEqual({ status: 'failed' });
  });

  test('does not decrypt ordinary NIP-17 with the account identity key', async () => {
    const senderIdentity = generateSecretKey();
    const recipientIdentity = generateSecretKey();
    const recipientEncryption = generateSecretKey();
    const wrapped = await createGiftWrappedMessage({
      rumorTemplate: { kind: KIND_CHAT, content: 'ordinary', tags: [], created_at: 1_700_000_011 },
      senderIdentityPubkey: getPublicKey(senderIdentity),
      senderEncPrivkey: senderIdentity, senderEncPubkey: getPublicKey(senderIdentity),
      recipientIdentityPubkey: getPublicKey(recipientIdentity),
      recipientEncPubkey: getPublicKey(recipientIdentity),
      signSeal: async (template) => finalizeEvent(template, senderIdentity),
    });
    expect(await unwrapGiftWrapWithKeys(wrapped.giftWrap, [{ privkey: recipientEncryption }]))
      .toEqual({ status: 'failed' });
  });
});
