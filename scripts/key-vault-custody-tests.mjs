import assert from 'node:assert/strict';
import { generateSecretKey, getPublicKey, nip19, verifyEvent } from 'nostr-tools';
import { bytesToHex, hexToBytes } from 'nostr-tools/utils';
import { schnorr } from '@noble/curves/secp256k1.js';
import { sha256 } from '@noble/hashes/sha2.js';

/** The worker and native implementation must enforce the same secret-custody boundary. */
export async function exerciseVaultCustody(call, seed) {
  const generated = (await call({ method: 'generateEphemeral', purpose: 'account' })).value.pubkey;
  assert.equal((await call({ method: 'persistIdentity', account: generated })).error, undefined);
  await call({ method: 'endSession', account: generated });
  assert.equal((await call({ method: 'persistIdentity', account: generated })).error, undefined);
  assert.equal((await call({ method: 'publicKey', key: { account: generated, role: 'identity' } })).value, generated);
  const discarded = (await call({ method: 'generateEphemeral', purpose: 'account' })).value.pubkey;
  await call({ method: 'releaseEphemeral', account: discarded });
  assert.equal((await call({ method: 'persistIdentity', account: discarded })).error, true);
  const mismatched = getPublicKey(generateSecretKey());
  await seed({ [`identity_privkey_${mismatched}`]: bytesToHex(generateSecretKey()) });
  assert.equal((await call({ method: 'persistIdentity', account: mismatched })).error, true);
  const secret = generateSecretKey();
  const account = getPublicKey(secret);
  const nsec = nip19.nsecEncode(secret);
  for (const input of [nsec, nsec.toUpperCase()]) {
    assert.deepEqual((await call({ testImportIdentity: input })).value, { pubkey: account });
  }
  for (const input of [nsec.slice(0, -1) + (nsec.endsWith('q') ? 'p' : 'q'), 'N' + nsec.slice(1), nip19.npubEncode(account), nip19.nsecEncode(new Uint8Array(32))]) {
    assert.equal((await call({ testImportIdentity: input })).error, true);
  }
  assert.equal((await call({ method: 'importNsec', nsec })).error, true);
  for (const method of ['importIdentity', 'addMessaging', 'getItem']) {
    assert.equal((await call({ method, account, hex: bytesToHex(secret), createdAt: 1 })).error, true);
  }
  const nearby = generateSecretKey();
  await seed({ [`proximity_identity_privkey_${account}`]: bytesToHex(nearby) });
  const material = (await call({ method: 'ensureProximity', account })).value;
  assert.deepEqual(material, { pubkey: getPublicKey(nearby), key: { account, role: 'proximity' } });
  const bound = { ...material.key, pubkey: material.pubkey };
  const template = { kind: 1, created_at: 100, content: 'nearby event', tags: [] };
  const event = (await call({ method: 'signEvent', key: bound, template })).value;
  assert.equal(verifyEvent(event), true); assert.equal(event.pubkey, material.pubkey);
  const noise = generateSecretKey();
  const binding = (await call({ method: 'bindProximityNoise', account, noisePubkey: bytesToHex(noise) })).value;
  const digest = sha256(new Uint8Array([...new TextEncoder().encode('PsstPsst Nearby Noise Binding/1'), ...hexToBytes(material.pubkey), ...noise]));
  assert.equal(schnorr.verify(hexToBytes(binding), digest, hexToBytes(material.pubkey)), true);
  await call({ method: 'endSession', account });
  assert.deepEqual((await call({ method: 'ensureProximity', account })).value, material);
  await call({ method: 'removeProximity', account });
  assert.equal((await call({ method: 'signEvent', key: bound, template })).error, true);
  assert.notEqual((await call({ method: 'ensureProximity', account })).value.pubkey, material.pubkey);
  assert.equal((await call({ method: 'signEvent', key: bound, template })).error, true);
  assert.equal((await call({ method: 'publicKey', key: { account, role: 'identity' } })).value, account);
}
