import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { X509Certificate } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { signAndroid, signingMode } from './release-signing.mjs';

const credentials = {
  android: {
    ANDROID_KEYSTORE_BASE64: 'a2V5', ANDROID_KEYSTORE_PASSWORD: 'test-password',
    ANDROID_KEY_ALIAS: 'test-alias', ANDROID_KEY_PASSWORD: 'test-password',
  },
  macos: {
    MAC_CSC_LINK: 'test-certificate', MAC_CSC_KEY_PASSWORD: 'test-password',
    APPLE_ID: 'test@example.com', APPLE_APP_SPECIFIC_PASSWORD: 'test-password', APPLE_TEAM_ID: 'TESTTEAM01',
  },
};

for (const platform of ['android', 'macos']) {
  test(`${platform}: missing credentials only allow branch testing`, () => {
    assert.equal(signingMode(platform, { GITHUB_REF: 'refs/heads/master' }), 'testing');
    for (const event of ['push', 'workflow_dispatch']) {
      assert.throws(() => signingMode(platform, {
        GITHUB_REF: 'refs/tags/v1.0.0', GITHUB_EVENT_NAME: event,
      }), /signing requires/);
    }
  });

  test(`${platform}: complete credentials allow release signing`, () => {
    assert.equal(signingMode(platform, {
      ...credentials[platform], GITHUB_REF: 'refs/tags/v1.0.0',
    }), 'signed');
  });

  test(`${platform}: every missing credential fails without leaking values`, () => {
    for (const missing of Object.keys(credentials[platform])) {
      const env = { ...credentials[platform], [missing]: '' };
      assert.throws(() => signingMode(platform, env), (error) => {
        assert.ok(error.message.includes(missing));
        for (const value of Object.values(credentials[platform])) {
          assert.ok(!error.message.includes(value));
        }
        return true;
      });
    }
  });
}

test('invalid Base64 produces no distributable APK', () => {
  const dir = mkdtempSync(join(tmpdir(), 'psstpsst-invalid-signing-'));
  try {
    const input = join(dir, 'input.apk');
    const output = join(dir, 'output.apk');
    writeFileSync(input, 'fixture');
    assert.throws(() => signAndroid(input, output, {
      ...credentials.android, ANDROID_KEYSTORE_BASE64: 'not!base64', APKSIGNER: 'unused',
    }), /valid Base64/);
    assert.ok(!existsSync(output));
    assert.equal(readFileSync(input, 'utf8'), 'fixture');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

const sdk = process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT;
const buildTools = sdk && join(sdk, 'build-tools', '36.0.0');
const androidJar = sdk && join(sdk, 'platforms', 'android-36', 'android.jar');
test('real APK signing replaces the previous signer and rejects a wrong password', {
  skip: !sdk || !existsSync(join(buildTools, 'apksigner')) || !existsSync(androidJar),
}, () => {
  const dir = mkdtempSync(join(tmpdir(), 'psstpsst-apk-signing-test-'));
  const command = (executable, args, env = process.env) => {
    const result = spawnSync(executable, args, { env, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr || result.error?.message);
    return result.stdout;
  };
  try {
    const manifest = join(dir, 'AndroidManifest.xml');
    writeFileSync(manifest, '<manifest xmlns:android="http://schemas.android.com/apk/res/android" package="chat.psstpsst.signingtest" android:versionCode="1"><uses-sdk android:minSdkVersion="24"/><application/></manifest>');
    const input = join(dir, 'input.apk');
    const initial = join(dir, 'initial.apk');
    const output = join(dir, 'output.apk');
    command(join(buildTools, 'aapt2'), ['link', '--manifest', manifest, '-I', androidJar, '-o', input]);
    const apksigner = join(buildTools, 'apksigner');
    const signingEnv = { ...process.env, ...credentials.android, APKSIGNER: apksigner };
    for (const alias of ['first', 'second']) {
      const keystore = join(dir, `${alias}.p12`);
      command('keytool', ['-genkeypair', '-keystore', keystore, '-storetype', 'PKCS12',
        '-alias', alias, '-keyalg', 'RSA', '-keysize', '2048', '-validity', '1',
        '-dname', 'CN=Disposable signing test', '-storepass:env', 'ANDROID_KEYSTORE_PASSWORD'], signingEnv);
      signingEnv.ANDROID_KEYSTORE_BASE64 = readFileSync(keystore).toString('base64');
      signingEnv.ANDROID_KEY_ALIAS = alias;
      signAndroid(alias === 'first' ? input : initial, alias === 'first' ? initial : output, signingEnv);
    }
    const fingerprint = (apk) => command(apksigner, ['verify', '--print-certs', apk])
      .match(/Signer #1 certificate SHA-256 digest: (.+)/)[1];
    assert.notEqual(fingerprint(initial), fingerprint(output));
    const expected = command('keytool', ['-exportcert', '-rfc', '-keystore', join(dir, 'second.p12'),
      '-alias', 'second', '-storepass:env', 'ANDROID_KEYSTORE_PASSWORD'], signingEnv);
    // Compare the APK signer with the actual replacement key, not just any different key.
    assert.equal(fingerprint(output), new X509Certificate(expected).fingerprint256.replaceAll(':', '').toLowerCase());
    assert.throws(() => signAndroid(initial, output, {
      ...signingEnv, ANDROID_KEYSTORE_PASSWORD: 'wrong-password',
    }), /failed/);
    assert.ok(!existsSync(output));
    const testingEnv = { ...process.env, APKSIGNER: apksigner };
    for (const name of Object.keys(credentials.android)) delete testingEnv[name];
    delete testingEnv.GITHUB_REF;
    signAndroid(initial, output, testingEnv);
    assert.deepEqual(readFileSync(output), readFileSync(initial));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
