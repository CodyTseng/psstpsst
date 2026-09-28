import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const scriptDirectory = dirname(fileURLToPath(import.meta.url));

function run(command, args, env) {
  const result = spawnSync(command, args, { env, stdio: 'inherit' });
  if (result.error) throw new Error(`Cannot run ${command}: ${result.error.message}`);
  if (result.status !== 0) throw new Error(`${command} failed (exit ${result.status}).`);
}

export function verificationCommands(unsignedApk, signedApk, copiedApk, env = process.env) {
  const sdk = env.ANDROID_HOME || env.ANDROID_SDK_ROOT;
  if (!env.APKSIGNER && !sdk) throw new Error('Set ANDROID_HOME or APKSIGNER.');
  const apksigner = env.APKSIGNER || join(sdk, 'build-tools', '36.0.0', 'apksigner');
  return [
    [env.PYTHON || 'python3', [join(scriptDirectory, 'copy-apk-signature.py'), signedApk, unsignedApk, copiedApk]],
    [apksigner, ['verify', '--verbose', '--print-certs', copiedApk]],
  ];
}

export function verifyFdroidReproducibility(unsignedApk, signedApk, env = process.env, execute = run) {
  if (!unsignedApk || !signedApk || resolve(unsignedApk) === resolve(signedApk)) {
    throw new Error('Provide distinct unsigned and signed APK paths.');
  }
  const unsigned = resolve(unsignedApk);
  const signed = resolve(signedApk);
  if (!existsSync(unsigned)) throw new Error(`Unsigned APK does not exist: ${unsigned}`);
  if (!existsSync(signed)) throw new Error(`Signed APK does not exist: ${signed}`);

  const temporary = mkdtempSync(join(tmpdir(), 'psstpsst-fdroid-verify-'));
  try {
    const copied = join(temporary, 'signature-copied.apk');
    for (const [command, args] of verificationCommands(unsigned, signed, copied, env)) {
      execute(command, args, env);
    }
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const [unsignedApk, signedApk, ...extra] = process.argv.slice(2);
    if (extra.length) throw new Error('Too many arguments.');
    verifyFdroidReproducibility(unsignedApk, signedApk);
    console.log('F-Droid signature-copy verification passed.');
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
