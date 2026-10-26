import { execFileSync } from 'node:child_process';
import path from 'node:path';

export function buildVaultObjects(directory) {
  const root = path.resolve(import.meta.dirname, '..');
  const native = path.join(root, 'modules/expo-crypto-accelerator');
  const secp = path.join(native, 'android/src/main/cpp/secp256k1');
  return [
    ['ios/ExpoCryptoAcceleratorSecp256k1Lib.c', ['-DENABLE_MODULE_EXTRAKEYS=1', '-DENABLE_MODULE_SCHNORRSIG=1', '-DECMULT_WINDOW_SIZE=15', '-DCOMB_BLOCKS=43', '-DCOMB_TEETH=6', '-DSECP256K1_NO_API_VISIBILITY_ATTRIBUTES=1']],
    ['ios/ExpoCryptoAcceleratorSecp256k1.m', ['-fobjc-arc']],
    ['shared/VaultChaCha.c', []],
    ['shared/VaultPin.c', []],
  ].map(([file, extra]) => {
    const output = path.join(directory, path.basename(file) + '.o');
    execFileSync('xcrun', ['clang', '-O2', '-c', path.join(native, file), '-I' + path.join(secp, 'include'), '-I' + path.join(secp, 'src'), ...extra, '-o', output], { cwd: root, timeout: 60000 });
    return output;
  });
}
