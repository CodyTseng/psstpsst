import assert from 'node:assert/strict';
import { finalizeEvent, generateSecretKey, getPublicKey, nip44, verifyEvent } from 'nostr-tools';
import { bytesToHex } from 'nostr-tools/utils';

/** Exercise the same security boundary in the real worker and shipping Swift vault. */
export async function exerciseSealedPairing(call, reverse = false) {
  const bunkerKey = generateSecretKey(), accountKey = generateSecretKey();
  const peer = getPublicKey(bunkerKey), account = getPublicKey(accountKey);
  const relays = ['wss://relay.example/?x=a+b&lang=zh'];
  const credential = 'user-supplied-bunker-credential';
  const begin = async secret => {
    const result = await call({ method: 'beginBunkerPairing', peer: reverse ? null : peer, secret: reverse ? null : secret, relays });
    assert.equal(result.error, undefined);
    assert.deepEqual(Object.keys(result.value).sort(), ['clientPubkey', 'session', 'uri']);
    return result.value;
  };
  const deliver = async (pair, value) => {
    const conversation = nip44.v2.utils.getConversationKey(bunkerKey, pair.clientPubkey);
    const event = finalizeEvent({ kind: 24133, created_at: 100, tags: [['p', pair.clientPubkey]], content: nip44.v2.encrypt(JSON.stringify(value), conversation) }, bunkerKey);
    return call({ method: 'bunkerPairingReceive', session: pair.session, event });
  };
  const handshake = async pair => {
    if (reverse) {
      const uri = new URL(pair.uri);
      assert.equal(uri.hostname, pair.clientPubkey); assert.deepEqual(uri.searchParams.getAll('relay'), relays);
      assert.equal((await deliver(pair, { id: 'discovery', result: 'wrong-secret' })).value.type, 'ignored');
      assert.equal((await deliver(pair, { id: 'discovery', result: uri.searchParams.get('secret') })).value.type, 'peer');
    }
    for (const operation of ['connect', 'get_public_key']) {
      const prepared = await call({ method: 'bunkerPairingRequest', session: pair.session, operation });
      assert.equal(verifyEvent(prepared.value), true); assert.equal(prepared.value.pubkey, pair.clientPubkey);
      const request = JSON.parse(nip44.v2.decrypt(prepared.value.content, nip44.v2.utils.getConversationKey(bunkerKey, pair.clientPubkey)));
      assert.equal(request.method, operation);
      assert.equal((await deliver(pair, { id: 'wrong-id', result: account })).value.type, 'ignored');
      const result = await deliver(pair, { id: request.id, result: operation === 'connect' ? 'ack' : account });
      assert.equal(result.value.type, operation === 'connect' ? 'connected' : 'account');
    }
  };
  const first = await begin(credential);
  assert.equal((await call({ method: 'commitBunkerPairing', session: first.session })).error, true);
  assert.equal((await call({ method: 'persistIdentity', account: first.clientPubkey })).error, true);
  assert.equal((await call({ method: 'publicKey', key: { account: first.clientPubkey, role: 'ephemeral' } })).error, true);
  await handshake(first);
  const committed = await call({ method: 'commitBunkerPairing', session: first.session });
  assert.equal(committed.value.pubkey, account); assert.equal(committed.value.existing, false);
  assert.deepEqual((await call({ method: 'commitBunkerPairing', session: first.session })).value, committed.value);
  assert.equal((await call({ method: 'publicKey', key: { account, role: 'nip46-client' } })).value, first.clientPubkey);
  const attacker = generateSecretKey();
  for (const method of ['storeClient', 'storeBunkerSecret', 'removeClient', 'removeBunkerSecret']) {
    assert.equal((await call({ method, account, peer, hex: bytesToHex(attacker), secret: 'replacement' })).error, true);
  }
  await call({ method: 'migrateBunkerSecret', account, peer, secret: 'replacement' });
  const request = await call({ method: 'bunkerRequest', account, peer, id: 'reconnect', operation: 'connect', params: [] });
  assert.equal(request.value.pubkey, first.clientPubkey);
  const clear = JSON.parse(nip44.v2.decrypt(request.value.content, nip44.v2.utils.getConversationKey(bunkerKey, first.clientPubkey)));
  assert.equal(clear.params[1], reverse ? new URL(first.uri).searchParams.get('secret') : credential);
  assert.throws(() => nip44.v2.decrypt(request.value.content, nip44.v2.utils.getConversationKey(attacker, peer)));

  const second = await begin('another-supplied-credential');
  assert.notEqual(second.clientPubkey, first.clientPubkey);
  await handshake(second);
  assert.equal((await call({ method: 'commitBunkerPairing', session: second.session })).value.existing, true);
  assert.equal((await call({ method: 'publicKey', key: { account, role: 'nip46-client' } })).value, first.clientPubkey);
  const again = await call({ method: 'bunkerRequest', account, peer, id: 'unchanged', operation: 'connect', params: [] });
  assert.equal(JSON.parse(nip44.v2.decrypt(again.value.content, nip44.v2.utils.getConversationKey(bunkerKey, first.clientPubkey))).params[1], clear.params[1]);
  await call({ method: 'cancelBunkerPairing', session: first.session });
  await call({ method: 'cancelBunkerPairing', session: second.session });
  const abandoned = await begin(credential);
  await call({ method: 'cancelBunkerPairing', session: abandoned.session });
  assert.equal((await call({ method: 'commitBunkerPairing', session: abandoned.session })).error, true);
}
