import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

const files = {
  ios: 'node_modules/expo-secure-store/ios/SecureStoreModule.swift',
  android: 'node_modules/expo-secure-store/android/src/main/java/expo/modules/securestore/SecureStoreModule.kt',
};
const prefixes = ['identity_privkey_', 'encryption_keys_', 'nip46_client_privkey_', 'nip46_bunker_secret_',
  'nip46_bunker_binding_', 'proximity_identity_privkey_', 'proximity_identity_noise_privkey_',
  'wallet_credential_', 'psstpsst.nwc.', 'psstpsst.wallet.pin.'];

test('both native SecureStore bridges block every credential namespace in every public entry point', async () => {
  const patch = await readFile('patches/expo-secure-store+57.0.4.patch', 'utf8');
  for (const [platform, file] of Object.entries(files)) {
    const source = await readFile(file, 'utf8');
    const guard = source.match(/  private func assertPublicKey[\s\S]*?\n  }|  private fun assertPublicKey[\s\S]*?\n  }/)[0];
    for (const prefix of prefixes) assert.ok(guard.includes(JSON.stringify(prefix)), `${platform}: missing ${prefix}`);
    for (const line of guard.split('\n')) assert.ok(patch.includes('+' + line), `${platform}: patch must preserve the installed guard`);
    for (const method of ['getValueWithKeyAsync', 'getValueWithKeySync', 'setValueWithKeyAsync', 'setValueWithKeySync', 'deleteValueWithKeyAsync']) {
      const body = source.slice(source.indexOf(`("${method}")`)).split(/\n    (?:AsyncFunction|Function)\(/)[0];
      assert.ok(body.includes('assertPublicKey(key)'), `${platform}: ${method} must enforce native protection`);
    }
  }
});

test('the compiled native policy rejects legacy wallet and Nearby reads before migration', { skip: process.platform !== 'darwin' }, async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'psst-secure-store-guard-'));
  try {
    const source = await readFile(files.ios, 'utf8');
    const guard = source.match(/  private func assertPublicKey[\s\S]*?\n  }/)[0];
    const fixture = path.join(directory, 'guard.swift');
    const executable = path.join(directory, 'guard');
    await writeFile(fixture, `import Foundation\n${guard}\nfor key in CommandLine.arguments.dropFirst() { do { try assertPublicKey(key); print("allowed") } catch { print("blocked") } }`);
    execFileSync('xcrun', ['swiftc', '-module-cache-path', path.join(directory, 'cache'), fixture, '-o', executable]);
    const blocked = prefixes.flatMap(prefix => [prefix + 'a'.repeat(64), 'app-' + prefix + 'a'.repeat(64)]);
    const allowed = ['language.preference', 'theme.preference', 'chat.quickReactions', 'notifications.enabled'];
    const output = execFileSync(executable, [...blocked, ...allowed], { encoding: 'utf8' }).trim().split('\n');
    assert.deepEqual(output, [...blocked.map(() => 'blocked'), ...allowed.map(() => 'allowed')]);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
