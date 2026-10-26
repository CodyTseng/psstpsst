import { exerciseWalletCustody } from './wallet-custody-tests.mjs';
import { exerciseGeneratedBackup } from './generated-backup-tests.mjs';
import { exerciseVaultRevision } from './vault-revision-tests.mjs';
import { exerciseVaultCustody } from './key-vault-custody-tests.mjs';
import { exerciseMessagingDecryption } from './messaging-custody-tests.mjs';
import { exerciseSealedPairing } from './key-vault-pairing-tests.mjs';
import { buildVaultObjects } from './key-vault-native-build.mjs';
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir, platform } from 'node:os';
import path from 'node:path';
import readline from 'node:readline';
import { after, before, test } from 'node:test';
import { generateSecretKey, getPublicKey, nip19, nip44, verifyEvent } from 'nostr-tools';
import * as nip04 from 'nostr-tools/nip04';
import { bytesToHex } from 'nostr-tools/utils';

const root = path.resolve(import.meta.dirname, '..');
const native = path.join(root, 'modules/expo-crypto-accelerator');
const nativeTest = platform() === 'darwin' ? test : test.skip;
let directory, harness, request;
before(() => {
  if (platform() !== 'darwin') return;
  directory = mkdtempSync(path.join(tmpdir(), 'psst-vault-native-'));
  const objects = buildVaultObjects(directory);
  const executable = path.join(directory, 'vault');
  execFileSync('xcrun', ['swiftc', '-O', '-module-cache-path', path.join(directory, 'cache'), '-import-objc-header', path.join(native, 'ios/ExpoCryptoAcceleratorSecp256k1.h'), path.join(native, 'ios/NativeKeyVault.swift'), path.join(root, 'scripts/fixtures/key-vault-harness.swift'), path.join(root, 'scripts/fixtures/key-vault-storage-tests.swift'), ...objects, '-framework', 'Security', '-o', executable], { cwd: root });
  harness = spawn(executable, [], { stdio: ['pipe', 'pipe', 'inherit'] });
  const lines = readline.createInterface({ input: harness.stdout });
  const waiting = [];
  lines.on('line', line => waiting.shift()?.(JSON.parse(line)));
  harness.on('exit', code => { if (code) console.error('Native vault harness exited:', code); });
  request = command => new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Native vault request timed out: ' + command.method)), 5000);
    waiting.push(value => { clearTimeout(timer); resolve(value); });
    harness.stdin.write(JSON.stringify(command) + '\n');
  });
});
after(() => { harness?.kill(); if (directory) rmSync(directory, { recursive: true, force: true }); });
const secret = generateSecretKey(), peerSecret = generateSecretKey();
const account = getPublicKey(secret), peer = getPublicKey(peerSecret);
const key = { account, role: 'identity' };

nativeTest('native vault signatures, NIP-44 and NIP-04 interoperate with nostr-tools', async () => {
  assert.equal((await request({ testImportIdentity: nip19.nsecEncode(secret) })).error, undefined);
  assert.equal((await request({ method: 'publicKey', key })).value, account);
  for (const content of ['hello', '中文\n🙂 </script> \\ / \u2028', 'x'.repeat(65535), 'x'.repeat(65536)]) {
    const signed = await request({ method: 'signEvent', key, template: { kind: 1, created_at: 100, tags: [['t', content.slice(0, 12)]], content } });
    assert.equal(verifyEvent(signed.value), true);
    for (const algorithm of ['nip44', 'nip04']) {
      const encrypted = await request({ method: 'crypto', key, algorithm, operation: 'encrypt', peer, text: content });
      const decoded = algorithm === 'nip44' ? nip44.v2.decrypt(encrypted.value, nip44.v2.utils.getConversationKey(peerSecret, account)) : await nip04.decrypt(peerSecret, account, encrypted.value);
      assert.equal(decoded, content);
      const ciphertext = algorithm === 'nip44' ? nip44.v2.encrypt(content, nip44.v2.utils.getConversationKey(peerSecret, account)) : await nip04.encrypt(peerSecret, account, content);
      assert.equal((await request({ method: 'crypto', key, algorithm, operation: 'decrypt', peer, text: ciphertext })).value, content);
    }
  }
  assert.equal((await request({ testBackup: account })).value, nip19.nsecEncode(secret));
});

nativeTest('messaging metadata, encrypted transfer, opaque temporary keys and revocation', async () => {
  const generated = (await request({ method: 'generateMessaging', account })).value;
  assert.deepEqual(Object.keys(generated).sort(), ['createdAt', 'key', 'pubkey']);
  const recipient = (await request({ method: 'generateEphemeral', purpose: 'key-sync' })).value;
  const transfer = (await request({ method: 'exportTransfer', account, pubkey: generated.pubkey, recipient: recipient.pubkey })).value;
  assert.equal((await request({ method: 'persistIdentity', account: recipient.pubkey })).error, true);
  assert.equal((await request({ testBackup: recipient.pubkey })).value, null);
  assert.equal((await request({ method: 'crypto', key: recipient.key, algorithm: 'nip44', operation: 'decrypt', peer: transfer.senderPubkey, text: transfer.content })).error, true);
  const other = getPublicKey(generateSecretKey());
  assert.equal((await request({ method: 'importTransfer', account: other, client: recipient.key, sender: transfer.senderPubkey, ciphertext: transfer.content, expectedPubkey: generated.pubkey, createdAt: 100 })).value, true);
  assert.equal((await request({ method: 'getCurrentMessagingKey', account: other })).value.pubkey, generated.pubkey);
  assert.equal((await request({ method: 'importTransfer', account: other, client: recipient.key, sender: transfer.senderPubkey, ciphertext: transfer.content, expectedPubkey: peer, createdAt: 100 })).value, false);
  await request({ method: 'releaseEphemeral', account: recipient.pubkey });
  assert.equal((await request({ method: 'publicKey', key: recipient.key })).error, true);
  await request({ method: 'endSession', account });
  assert.equal((await request({ method: 'publicKey', key })).value, account);
});

nativeTest('bunker requests cannot be decrypted back into stored connection credentials', async () => {
  const client = generateSecretKey();
  await request({ testSeed: { [`nip46_client_privkey_${account}`]: bytesToHex(client),
    [`nip46_bunker_secret_${account}`]: 'private-bunker-secret', [`nip46_bunker_binding_${account}`]: peer } });
  const event = (await request({ method: 'bunkerRequest', account, peer, id: 'request', operation: 'connect', params: [] })).value;
  assert.equal(verifyEvent(event), true);
  const clear = nip44.v2.decrypt(event.content, nip44.v2.utils.getConversationKey(peerSecret, getPublicKey(client)));
  assert.equal(JSON.parse(clear).params[1], 'private-bunker-secret');
  assert.equal((await request({ method: 'crypto', key: { account, role: 'nip46-client' }, algorithm: 'nip44', operation: 'decrypt', peer, text: event.content })).error, true);
  const response = nip44.v2.encrypt(JSON.stringify({ id: 'request', result: 'ack' }), nip44.v2.utils.getConversationKey(peerSecret, getPublicKey(client)));
  assert.equal(JSON.parse((await request({ method: 'crypto', key: { account, role: 'nip46-client' }, algorithm: 'nip44', operation: 'decrypt', peer, text: response })).value).result, 'ack');
});


nativeTest('legacy keys migrate without exposing private bytes, and bunker peer binding cannot be replaced', async () => {
  const legacyAccount = getPublicKey(generateSecretKey());
  const legacyKey = generateSecretKey();
  await request({ testSeed: {
    [`encryption_keys_${legacyAccount}`]: JSON.stringify([bytesToHex(legacyKey)]),
    [`nip46_client_privkey_${legacyAccount}`]: bytesToHex(generateSecretKey()),
    [`nip46_bunker_secret_${legacyAccount}`]: 'legacy-secret',
  } });
  const keys = (await request({ method: 'getCurrentMessagingKey', account: legacyAccount })).value;
  assert.equal(keys.pubkey, getPublicKey(legacyKey));
  assert.equal('privkey' in keys, false);
  const command = { method: 'bunkerRequest', account: legacyAccount, peer, id: 'legacy', operation: 'connect', params: [] };
  assert.equal((await request(command)).error, true);
  assert.equal((await request({ testBind: [legacyAccount, peer] })).error, undefined);
  assert.equal(verifyEvent((await request(command)).value), true);
  assert.equal((await request({ testBind: [legacyAccount, account] })).error, true);
  assert.equal((await request({ ...command, peer: account })).error, true);
});


nativeTest('new-account temporary keys can be backed up and committed without returning their bytes', async () => {
  const candidate = (await request({ method: 'generateEphemeral', purpose: 'account' })).value;
  assert.equal('privkey' in candidate, false);
  const backup = (await request({ testBackup: candidate.pubkey })).value;
  assert.equal(getPublicKey(nip19.decode(backup).data), candidate.pubkey);
  assert.equal((await request({ method: 'persistIdentity', account: candidate.pubkey })).error, undefined);
  await request({ method: 'releaseEphemeral', account: candidate.pubkey });
  assert.equal((await request({ method: 'publicKey', key: { account: candidate.pubkey, role: 'identity' } })).value, candidate.pubkey);
});

for (const reverse of [false, true]) {
  nativeTest(`native sealed ${reverse ? 'Nostr Connect' : 'bunker URI'} pairing preserves the original client and credential`, async () => {
    await exerciseSealedPairing(request, reverse);
  });
}

nativeTest('native vault imports nsec without returning private bytes and preserves nearby identity custody', async () => {
  await exerciseVaultCustody(request, values => request({ testSeed: values }));
});

nativeTest('native storage blocks raw SecureStore reads, safely retries migration and rejects legacy reinjection', async () => {
  assert.equal((await request({ testStorage: true })).error, undefined);
});

nativeTest('wallet secrets and PIN verifiers stay native, payments require trusted authentication and responses are bound', async () => {
  await exerciseWalletCustody(request, (action, account, value) => request({ testWallet: { action, account, value } }), values => request({ testSeed: values }));
});

nativeTest('messaging decryption owns historical selection, same-key envelopes and retention', async () => {
  await exerciseMessagingDecryption(request);
});

nativeTest('message-key generation and import invalidate pending trusted approvals', async () => {
  const revision = async () => (await request({ testRevision: true })).value;
  const previous = await revision();
  await exerciseVaultRevision(request, revision);
  assert.equal((await request({ testWithRevision: previous })).value, false);
});

nativeTest('generated accounts expose backup material only through the private host helper', async () => {
  await exerciseGeneratedBackup(request);
});
