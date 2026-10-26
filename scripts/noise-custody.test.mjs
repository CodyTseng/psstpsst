import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { after, before, test } from 'node:test';
import { build } from 'esbuild';
import { pureJsCrypto } from '@libp2p/noise/crypto/js';

let directory, service, Service;
const stored = new Map();
const storage = { getItem: async name => stored.get(name) ?? null, setItem: async (name, value) => { stored.set(name, value); }, deleteItem: async name => { stored.delete(name); } };
before(async () => {
  directory = await mkdtemp(path.join(tmpdir(), 'psst-noise-custody-'));
  await build({ entryPoints: ['desktop/noise-service.ts', 'desktop/noise-worker.ts'], bundle: true, platform: 'node', format: 'cjs', outdir: directory });
  Service = createRequire(import.meta.url)(path.join(directory, 'noise-service.js')).NoiseService;
  service = new Service(storage);
});
after(async () => { await service?.close(); if (directory) await rm(directory, { recursive: true, force: true }); });

test('saved Noise identities retain their public keys across concurrent use and process recreation', async () => {
  const account = '1'.repeat(64), seed = new Uint8Array(32).fill(9);
  stored.set(`proximity_identity_noise_privkey_${account}`, Buffer.from(seed).toString('hex'));
  const expected = pureJsCrypto.generateX25519KeyPairFromSeed(seed).publicKey;
  const values = await Promise.all([service.ensureIdentity(account), service.ensureIdentity(account)]);
  for (const value of values) assert.deepEqual(value, expected);
  await service.close(); service = new Service(storage);
  assert.deepEqual(await service.ensureIdentity(account), expected);
  await assert.rejects(service.ensureIdentity('../outside'));
});

test('account handshakes exchange encrypted records using saved static keys without returning them', async () => {
  const a = '2'.repeat(64), b = '3'.repeat(64);
  const pubA = await service.ensureIdentity(a), pubB = await service.ensureIdentity(b);
  assert.equal(pubA.length, 32); assert.equal(pubB.length, 32);
  const initiator = await service.createAccountHandshake(a, 'initiator');
  const responder = await service.createAccountHandshake(b, 'responder');
  const message = new TextEncoder().encode('profile');
  assert.deepEqual(await service.readHandshake(responder, await service.writeHandshake(initiator, message)), message);
  assert.deepEqual(await service.readHandshake(initiator, await service.writeHandshake(responder, message)), message);
  assert.deepEqual(await service.readHandshake(responder, await service.writeHandshake(initiator, message)), message);
  assert.deepEqual(await service.getRemoteStaticKey(initiator), pubB);
  assert.deepEqual(await service.getRemoteStaticKey(responder), pubA);
  const tx = await service.finishHandshake(initiator, 65_535), rx = await service.finishHandshake(responder, 65_535);
  const record = await service.seal(tx.handle, 0x10, message);
  assert.deepEqual(await service.open(rx.handle, record), { type: 0x10, payload: message });
  await service.destroySession(tx.handle); await service.destroySession(rx.handle);
  await service.removeIdentity(a);
  assert.equal(stored.has(`proximity_identity_noise_privkey_${a}`), false);
  assert.notDeepEqual(await service.ensureIdentity(a), pubA);
  assert.deepEqual(await service.ensureIdentity(b), pubB);
});
