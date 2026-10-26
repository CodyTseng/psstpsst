import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools';

import {
  KIND_CHAT,
  KIND_REACTION,
  createGiftWrappedMessage,
  unwrapGiftWrap,
  unwrapGiftWrapForAccount,
} from '../nip17-gift-wrap';

import { vaultAccess } from '@/platform/vault-access';

jest.mock('@/platform/vault-access', () => ({ vaultAccess: { execute: jest.fn() } }));

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

  test('routes a split-key gift wrap by recipient identity only', async () => {
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
    expect(wrapped.giftWrap.tags).toEqual([['p', recipientIdentityPubkey]]);
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
  beforeEach(() => jest.clearAllMocks());

  test('delegates key selection and both decryptions to the account vault in one request', async () => {
    const { wrapped, recipientIdentity } = await splitKeyFixture();
    const account = getPublicKey(recipientIdentity);
    jest.mocked(vaultAccess.execute).mockResolvedValue({ status: 'decrypted', seal: wrapped.seal,
      rumorJson: JSON.stringify(wrapped.rumor), senderEncryptionPubkey: wrapped.seal.tags[0][1] });
    const result = await unwrapGiftWrapForAccount(wrapped.giftWrap, account);
    expect(result.status).toBe('decrypted');
    if (result.status === 'decrypted') expect(result.value.rumor).toEqual(wrapped.rumor);
    expect(vaultAccess.execute).toHaveBeenCalledTimes(1);
    expect(vaultAccess.execute).toHaveBeenCalledWith({ method: 'decryptMessaging', account, event: wrapped.giftWrap });
  });

  test.each([
    { status: 'failed' },
    { status: 'unsupported', reason: 'missing-encryption-key-tag' },
  ])('preserves the vault outcome $status without retrying in business code', async outcome => {
    const { wrapped } = await splitKeyFixture();
    jest.mocked(vaultAccess.execute).mockResolvedValue(outcome);
    expect(await unwrapGiftWrapForAccount(wrapped.giftWrap, 'account')).toEqual(outcome);
    expect(vaultAccess.execute).toHaveBeenCalledTimes(1);
  });

  test.each(['invalid JSON', 'mismatched author', 'mismatched hash'])('rejects a decrypted rumor with %s', async corruption => {
    const { wrapped } = await splitKeyFixture();
    const rumor = { ...wrapped.rumor };
    if (corruption === 'mismatched author') rumor.pubkey = getPublicKey(generateSecretKey());
    if (corruption === 'mismatched hash') rumor.id = '0'.repeat(64);
    jest.mocked(vaultAccess.execute).mockResolvedValue({ status: 'decrypted', seal: wrapped.seal,
      rumorJson: corruption === 'invalid JSON' ? '{' : JSON.stringify(rumor), senderEncryptionPubkey: wrapped.seal.tags[0][1] });
    expect(await unwrapGiftWrapForAccount(wrapped.giftWrap, 'account')).toEqual({ status: 'failed' });
  });

  test('preserves vault infrastructure failures instead of treating them as unreadable events', async () => {
    const { wrapped } = await splitKeyFixture();
    jest.mocked(vaultAccess.execute).mockRejectedValue(new Error('Storage unavailable'));
    await expect(unwrapGiftWrapForAccount(wrapped.giftWrap, 'account')).rejects.toThrow('Storage unavailable');
  });
});
