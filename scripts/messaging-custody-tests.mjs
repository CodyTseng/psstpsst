import assert from 'node:assert/strict';
import { finalizeEvent, generateSecretKey, getEventHash, getPublicKey, nip19, nip44 } from 'nostr-tools';

/** Run against both the real worker and Swift vault, never a mocked decryption path. */
export async function exerciseMessagingDecryption(call) {
  const identity = generateSecretKey();
  const account = getPublicKey(identity);
  await call({ testImportIdentity: nip19.nsecEncode(identity) });
  const historical = (await call({ method: 'generateMessaging', account })).value;
  const current = (await call({ method: 'generateMessaging', account })).value;
  assert.deepEqual((await call({ method: 'getCurrentMessagingKey', account })).value, current);
  assert.equal((await call({ method: 'hasMessagingKey', account, pubkey: historical.pubkey })).value, true);
  assert.equal((await call({ method: 'hasMessagingKey', account, pubkey: current.pubkey.toUpperCase() })).value, true);
  assert.equal((await call({ method: 'hasMessagingKey', account, pubkey: getPublicKey(generateSecretKey()) })).value, false);
  assert.equal((await call({ method: 'hasMessagingKey', account, pubkey: 'invalid' })).value, false);
  assert.equal((await call({ method: 'listMessaging', account })).error, true);
  const emptyAccount = getPublicKey(generateSecretKey());
  assert.equal((await call({ method: 'getCurrentMessagingKey', account: emptyAccount })).value, null);
  assert.equal((await call({ method: 'hasMessagingKey', account: emptyAccount, pubkey: current.pubkey })).value, false);
  const sender = generateSecretKey();
  const encryption = generateSecretKey();
  const rumor = { pubkey: getPublicKey(sender), kind: 14, created_at: 1700000000, content: 'retained message', tags: [] };
  rumor.id = getEventHash(rumor);
  const fixture = (recipient, options = {}) => {
    const seal = finalizeEvent({ kind: 13, created_at: rumor.created_at,
      tags: options.tags ?? [['n', getPublicKey(encryption)]],
      content: options.content ?? nip44.v2.encrypt(JSON.stringify(rumor), nip44.v2.utils.getConversationKey(encryption, options.innerRecipient ?? recipient)),
    }, sender);
    if (options.badSignature) seal.sig = '0'.repeat(128);
    const ephemeral = generateSecretKey();
    return finalizeEvent({ kind: 1059, created_at: rumor.created_at, tags: [['p', account]],
      content: nip44.v2.encrypt(JSON.stringify(seal), nip44.v2.utils.getConversationKey(ephemeral, recipient)),
    }, ephemeral);
  };
  const decrypt = async event => {
    const result = await call({ method: 'decryptMessaging', account, event });
    assert.equal(result.error, undefined);
    return result.value;
  };
  for (const key of [current, historical]) {
    const result = await decrypt(fixture(key.pubkey));
    assert.equal(result.status, 'decrypted');
    assert.deepEqual(JSON.parse(result.rumorJson), rumor);
    assert.deepEqual(Object.keys(result).sort(), ['rumorJson', 'seal', 'senderEncryptionPubkey', 'status']);
  }
  assert.deepEqual(await decrypt(fixture(current.pubkey, { tags: [], content: 'never decrypt this' })),
    { status: 'unsupported', reason: 'missing-encryption-key-tag' });
  for (const event of [
    fixture(getPublicKey(generateSecretKey())),
    fixture(account),
    fixture(current.pubkey, { tags: [['n']] }),
    fixture(current.pubkey, { content: 'invalid ciphertext' }),
    fixture(current.pubkey, { badSignature: true, tags: [] }),
    fixture(historical.pubkey, { innerRecipient: current.pubkey }),
    { ...fixture(current.pubkey), sig: '0'.repeat(128) },
  ]) assert.deepEqual(await decrypt(event), { status: 'failed' });
  const retainedEvent = fixture(historical.pubkey);
  assert.equal((await call({ method: 'crypto', key: historical.key, algorithm: 'nip44', operation: 'decrypt',
    peer: retainedEvent.pubkey, text: retainedEvent.content })).error, true);
  await call({ method: 'endSession', account });
  assert.equal((await decrypt(retainedEvent)).status, 'decrypted');
  const retained = [current];
  for (let index = 0; index < 9; index++) retained.push((await call({ method: 'generateMessaging', account })).value);
  assert.deepEqual((await call({ method: 'getCurrentMessagingKey', account })).value, retained.at(-1));
  assert.equal((await call({ method: 'hasMessagingKey', account, pubkey: historical.pubkey })).value, false);
  for (const key of retained) assert.equal((await call({ method: 'hasMessagingKey', account, pubkey: key.pubkey })).value, true);
  assert.deepEqual(await decrypt(retainedEvent), { status: 'failed' });
  assert.equal((await decrypt(fixture(current.pubkey))).status, 'decrypted');
  await call({ method: 'removeMessaging', account });
  assert.equal((await call({ method: 'getCurrentMessagingKey', account })).value, null);
  assert.equal((await call({ method: 'hasMessagingKey', account, pubkey: current.pubkey })).value, false);
  assert.deepEqual(await decrypt(fixture(current.pubkey)), { status: 'failed' });
}
