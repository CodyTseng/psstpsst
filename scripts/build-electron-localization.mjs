import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = path.join(root, 'desktop/dist/native');

function run(command, args) {
  const result = spawnSync(command, args, { stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

if (process.platform === 'darwin') {
  mkdirSync(output, { recursive: true });
  run('xcrun', [
    'clang', '-fobjc-arc', '-O2', '-arch', 'arm64', '-arch', 'x86_64',
    '-mmacosx-version-min=12.0', '-framework', 'Foundation',
    path.join(root, 'desktop/native/localization/clock.m'),
    '-o', path.join(output, 'system-localization'),
  ]);
} else if (process.platform === 'win32') {
  mkdirSync(output, { recursive: true });
  const target = path.join(root, 'desktop/.native-build/localization');
  run('cargo', [
    'build', '--release', '--locked', '--offline', '--manifest-path',
    path.join(root, 'desktop/native/localization/windows/Cargo.toml'),
    '--target-dir', target,
  ]);
  copyFileSync(path.join(target, 'release/psstpsst-system-localization.exe'), path.join(output, 'system-localization.exe'));
}
