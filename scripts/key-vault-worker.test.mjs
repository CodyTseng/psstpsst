import { exerciseWalletCustody } from './wallet-custody-tests.mjs';
import { exerciseGeneratedBackup } from './generated-backup-tests.mjs';
import { exerciseVaultRevision } from './vault-revision-tests.mjs';
import { exerciseMessagingDecryption } from './messaging-custody-tests.mjs';
import { exerciseVaultCustody } from './key-vault-custody-tests.mjs';
import { exerciseSealedPairing } from './key-vault-pairing-tests.mjs';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { before, after, test } from 'node:test';
import { build } from 'esbuild';
import { generateSecretKey, getPublicKey, nip19, nip44, verifyEvent } from 'nostr-tools';
import { bytesToHex } from 'nostr-tools/utils';

let directory, vault;
const callVault = async command => {
  try { return { value: command.testBackup !== undefined ? await vault.identityBackup(command.testBackup) : command.testImportIdentity !== undefined
    ? await vault.importIdentity(command.testImportIdentity) : await vault.execute(command) }; }
  catch { return { error: true }; }
};
test('generated accounts expose backup material only through the private host helper', async () => {
  await exerciseGeneratedBackup(callVault);
});
test('message-key generation and import invalidate pending trusted approvals', async () => {
  await exerciseVaultRevision(async command => ({ value: await vault.execute(command) }), async () => vault.revision);
});
test('messaging decryption owns historical selection, same-key envelopes and retention', async () => {
  await exerciseMessagingDecryption(callVault);
});
const stored = new Map();
const writes = new Map();
const failingWrites = new Set();
before(async () => {
  directory = await mkdtemp(path.join(tmpdir(), 'psst-vault-worker-'));
  await build({ entryPoints: ['desktop/key-vault-service.ts', 'desktop/key-vault-worker.ts'], bundle: true, platform: 'node', format: 'cjs', outdir: directory });
  const { KeyVaultService } = createRequire(import.meta.url)(path.join(directory, 'key-vault-service.js'));
  vault = new KeyVaultService({ getItem: async key => stored.get(key) ?? null,
    setItem: async (key, value) => {
      if (failingWrites.has(key)) throw new Error('Storage unavailable');
      writes.set(key, (writes.get(key) ?? 0) + 1);
      stored.set(key, value);
    }, deleteItem: async key => { stored.delete(key); } });
});
after(async () => { await vault?.destroy(); if (directory) await rm(directory, { recursive: true, force: true }); });

for (const format of ['bare', 'missing-timestamp']) {
  test(`legacy ${format} messaging keys normalize once and retain their rotation timestamp`, async () => {
    const account = getPublicKey(generateSecretKey());
    const secret = bytesToHex(generateSecretKey());
    const name = `encryption_keys_${account}`;
    stored.set(name, JSON.stringify([format === 'bare' ? secret : { privkey: secret }]));
    const first = await vault.execute({ method: 'getCurrentMessagingKey', account });
    const normalized = stored.get(name);
    await new Promise(resolve => setTimeout(resolve, 1100));
    assert.deepEqual(await vault.execute({ method: 'getCurrentMessagingKey', account }), first);
    assert.equal(writes.get(name), 1);
    assert.equal(stored.get(name), normalized);
    await vault.execute({ method: 'endSession', account });
    assert.deepEqual(await vault.execute({ method: 'getCurrentMessagingKey', account }), first);
    assert.equal(writes.get(name), 1);
  });
}

test('failed messaging-key normalization remains retryable', async () => {
  const account = getPublicKey(generateSecretKey());
  const name = `encryption_keys_${account}`;
  const legacy = JSON.stringify([bytesToHex(generateSecretKey())]);
  stored.set(name, legacy);
  failingWrites.add(name);
  try {
    await assert.rejects(vault.execute({ method: 'getCurrentMessagingKey', account }));
    assert.equal(stored.get(name), legacy);
  } finally { failingWrites.delete(name); }
  const result = await vault.execute({ method: 'getCurrentMessagingKey', account });
  assert.ok(result.createdAt > 0);
  await vault.execute({ method: 'getCurrentMessagingKey', account });
  assert.equal(writes.get(name), 1);
});

test('worker RPC exposes signing and crypto results, not stored keys or backup commands', async () => {
  const secret = generateSecretKey(); const account = getPublicKey(secret); const key = { account, role: 'identity' };
  await vault.importIdentity(nip19.nsecEncode(secret));
  const event = await vault.execute({ method: 'signEvent', key, template: { kind: 1, created_at: 100, tags: [], content: 'test' } });
  assert.equal(verifyEvent(event), true); assert.equal(event.pubkey, account);
  await assert.rejects(vault.execute({ method: 'getItem', key: `identity_privkey_${account}` }), /Key vault operation failed/);
  await assert.rejects(vault.execute({ method: 'identityBackup', account }), /Key vault operation failed/);
  assert.equal(await vault.identityBackup(account), nip19.nsecEncode(secret));
  await vault.execute({ method: 'endSession', account });
  assert.equal(await vault.execute({ method: 'publicKey', key }), account);
  await vault.execute({ method: 'removeIdentity', account });
  await assert.rejects(vault.execute({ method: 'publicKey', key }), /publicKey: KEY_NOT_FOUND/);
});

test('worker handles legacy messaging keys and encrypted transfer without a private-key result', async () => {
  const account = getPublicKey(generateSecretKey()); const secret = generateSecretKey();
  stored.set(`encryption_keys_${account}`, JSON.stringify([bytesToHex(secret)]));
  const metadata = await vault.execute({ method: 'getCurrentMessagingKey', account });
  assert.equal(metadata.pubkey, getPublicKey(secret)); assert.equal('privkey' in metadata, false);
  const temporary = await vault.execute({ method: 'generateEphemeral', purpose: 'key-sync' });
  const encrypted = await vault.execute({ method: 'exportTransfer', account, pubkey: metadata.pubkey, recipient: temporary.pubkey });
  await assert.rejects(vault.execute({ method: 'persistIdentity', account: temporary.pubkey }));
  assert.equal(await vault.identityBackup(temporary.pubkey), null);
  await assert.rejects(vault.execute({ method: 'crypto', key: temporary.key, algorithm: 'nip44', operation: 'decrypt', peer: encrypted.senderPubkey, text: encrypted.content }));
  const target = getPublicKey(generateSecretKey());
  assert.equal(await vault.execute({ method: 'importTransfer', account: target, client: temporary.key,
    sender: encrypted.senderPubkey, ciphertext: encrypted.content, expectedPubkey: metadata.pubkey, createdAt: 100 }), true);
  assert.equal((await vault.execute({ method: 'getCurrentMessagingKey', account: target })).pubkey, metadata.pubkey);
  await vault.execute({ method: 'releaseEphemeral', account: temporary.pubkey });
  await assert.rejects(vault.execute({ method: 'publicKey', key: temporary.key }));
});

test('generic messaging crypto permits encryption but requires the dedicated decryption operation', async () => {
  const account = getPublicKey(generateSecretKey());
  const current = await vault.execute({ method: 'generateMessaging', account });
  const peerSecret = generateSecretKey();
  const peer = getPublicKey(peerSecret);
  const text = await vault.execute({ method: 'crypto', key: current.key, algorithm: 'nip44', operation: 'encrypt', peer, text: 'message' });
  assert.equal(nip44.v2.decrypt(text, nip44.v2.utils.getConversationKey(peerSecret, current.pubkey)), 'message');
  await assert.rejects(vault.execute({ method: 'crypto', key: current.key, algorithm: 'nip44', operation: 'decrypt', peer, text }), /RESTRICTED_OPERATION/);
});

test('stored bunker credentials have a fixed recipient and reject a reflected connect request', async () => {
  const account = getPublicKey(generateSecretKey()); const client = generateSecretKey(); const peerSecret = generateSecretKey(); const peer = getPublicKey(peerSecret);
  stored.set(`nip46_client_privkey_${account}`, bytesToHex(client));
  stored.set(`nip46_bunker_secret_${account}`, 'bunker-credential');
  stored.set(`nip46_bunker_binding_${account}`, peer);
  const request = { method: 'bunkerRequest', account, peer, id: 'connect', operation: 'connect', params: [] };
  const event = await vault.execute(request);
  const clear = JSON.parse(nip44.v2.decrypt(event.content, nip44.v2.utils.getConversationKey(peerSecret, getPublicKey(client))));
  assert.equal(clear.params[1], 'bunker-credential');
  await assert.rejects(vault.execute({ ...request, peer: getPublicKey(generateSecretKey()) }));
  await assert.rejects(vault.execute({ method: 'crypto', key: { account, role: 'nip46-client' }, algorithm: 'nip44', operation: 'decrypt', peer, text: event.content }));
});

for (const reverse of [false, true]) {
  test(`sealed ${reverse ? 'Nostr Connect' : 'bunker URI'} pairing cannot replace a saved client or reveal its credential`, async () => {
    await exerciseSealedPairing(async command => {
      try { return { value: await vault.execute(command) }; } catch { return { error: true }; }
    }, reverse);
  });
}

test('worker imports nsec without returning private bytes and preserves nearby identity custody', async () => {
  const call = callVault;
  await exerciseVaultCustody(call, async values => { for (const [name, value] of Object.entries(values)) stored.set(name, value); });
});

test('wallet secrets and PIN verifiers stay in the worker and payment authority cannot be forged', async () => {
  const call = callVault;
  const internal = async (action, account, value) => { try { return { value: await vault.walletInternal(action, account, value) ?? null }; } catch { return { error: true }; } };
  await exerciseWalletCustody(call, internal, async values => { for (const [key, value] of Object.entries(values)) stored.set(key, value); });
});

test('startup migration normalizes inactive keys, preserves wallet bindings and finishes interrupted cleanup', async () => {
  const account = getPublicKey(generateSecretKey());
  const legacyName = `psstpsst.nwc.${account.slice(0, 16)}.legacy`;
  const credentialName = `wallet_credential_${account}_legacy`;
  const secret = bytesToHex(generateSecretKey());
  const peer = getPublicKey(generateSecretKey());
  const keysName = `encryption_keys_${account}`;
  stored.set(`nip46_bunker_secret_${account}`, 'saved-bunker-secret');
  stored.set(legacyName, secret);
  stored.set(keysName, JSON.stringify([secret]));
  const command = { method: 'migrateStorage', accounts: [account], bunkers: [{ account, peer }], wallets: [{ account, walletId: 'legacy', peer, relays: ['wss://wallet.example/'] }] };
  failingWrites.add(credentialName);
  await assert.rejects(vault.execute(command));
  assert.equal(stored.get(legacyName), secret);
  failingWrites.delete(credentialName);
  await vault.execute(command);
  assert.equal(stored.has(legacyName), false);
  assert.equal(stored.get(`nip46_bunker_binding_${account}`), peer);
  const credential = stored.get(credentialName);
  const normalized = stored.get(keysName);
  assert.equal(JSON.parse(normalized)[0].privkey, secret);
  assert.ok(JSON.parse(normalized)[0].createdAt > 0);
  stored.set(legacyName, secret);
  command.wallets[0].peer = getPublicKey(generateSecretKey());
  await vault.execute(command);
  assert.equal(stored.has(legacyName), false);
  assert.equal(stored.get(credentialName), credential);
  assert.equal(stored.get(keysName), normalized);
  assert.equal(writes.get(keysName), 1);
});
