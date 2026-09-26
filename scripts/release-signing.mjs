import { Buffer } from 'node:buffer';
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const signingVariables = {
  android: ['ANDROID_KEYSTORE_BASE64', 'ANDROID_KEYSTORE_PASSWORD', 'ANDROID_KEY_ALIAS', 'ANDROID_KEY_PASSWORD'],
  macos: ['MAC_CSC_LINK', 'MAC_CSC_KEY_PASSWORD', 'APPLE_ID', 'APPLE_APP_SPECIFIC_PASSWORD', 'APPLE_TEAM_ID'],
};

export function signingMode(platform, env = process.env) {
  const required = signingVariables[platform];
  if (!required) throw new Error(`Unknown signing platform: ${platform}`);
  const missing = required.filter((name) => !env[name]);
  if (missing.length === 0) return 'signed';
  if (missing.length !== required.length || env.GITHUB_REF?.startsWith('refs/tags/v')) {
    throw new Error(`${platform} signing requires: ${missing.join(', ')}. See docs/RELEASING.md.`);
  }
  return 'testing';
}

function run(command, args, env) {
  const result = spawnSync(command, args, { env, stdio: 'inherit' });
  if (result.error) throw new Error(`Cannot run ${command}: ${result.error.message}`);
  if (result.status !== 0) throw new Error(`${command} failed (exit ${result.status}).`);
}

export function androidSigningArguments(keyPath, output, input, env = process.env) {
  return [
    'sign', '--ks', keyPath, '--ks-key-alias', env.ANDROID_KEY_ALIAS,
    '--ks-pass', 'env:ANDROID_KEYSTORE_PASSWORD', '--key-pass', 'env:ANDROID_KEY_PASSWORD',
    '--v1-signing-enabled', 'false', '--v4-signing-enabled', 'false',
    '--alignment-preserved', '--out', output, input,
  ];
}

export function signAndroid(input, output, env = process.env) {
  const mode = signingMode('android', env);
  if (!input || !output || resolve(input) === resolve(output)) {
    throw new Error('Provide distinct input and output APK paths.');
  }
  const sdk = env.ANDROID_HOME || env.ANDROID_SDK_ROOT;
  if (!env.APKSIGNER && !sdk) throw new Error('Set ANDROID_HOME or APKSIGNER.');
  const apksigner = env.APKSIGNER || join(sdk, 'build-tools', '36.0.0', 'apksigner');
  mkdirSync(dirname(resolve(output)), { recursive: true });
  try {
    if (mode === 'testing') {
      console.log('No Android signing secrets configured; keeping the debug signature for testing.');
      copyFileSync(input, output);
    } else {
      const encoded = env.ANDROID_KEYSTORE_BASE64.replace(/\s/g, '');
      const keystore = Buffer.from(encoded, 'base64');
      if (!keystore.length || keystore.toString('base64') !== encoded) {
        throw new Error('ANDROID_KEYSTORE_BASE64 must contain a valid Base64-encoded keystore.');
      }
      const temporary = mkdtempSync(join(tmpdir(), 'psstpsst-signing-'));
      try {
        const keyPath = join(temporary, 'release.keystore');
        writeFileSync(keyPath, keystore, { mode: 0o600 });
        // Min SDK 24 supports v2; preserving alignment makes that signature transplantable by F-Droid.
        run(apksigner, androidSigningArguments(keyPath, output, input, env), env);
      } finally {
        rmSync(temporary, { recursive: true, force: true });
      }
    }
    run(apksigner, ['verify', '--verbose', '--print-certs', output], env);
  } catch (error) {
    rmSync(output, { force: true });
    throw error;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const [command, ...args] = process.argv.slice(2);
    if (command === 'check' && args.length === 1) {
      console.log(`${args[0]} signing mode: ${signingMode(args[0])}`);
    } else if (command === 'sign-android' && args.length === 2) {
      signAndroid(...args);
    } else {
      throw new Error('Usage: release-signing.mjs check <android|macos> | sign-android <input.apk> <output.apk>');
    }
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
