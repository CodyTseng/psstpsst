import { spawnSync } from 'node:child_process';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const nativeRoot = path.join(projectRoot, 'desktop', 'native', 'proximity');

const commands = {
  darwin: ['sh', [path.join(nativeRoot, 'macos', 'build.sh')]],
  linux: ['sh', [path.join(nativeRoot, 'linux', 'build.sh')]],
  win32: [
    'powershell.exe',
    ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(nativeRoot, 'windows', 'build.ps1')],
  ],
};

const selected = commands[process.platform];
if (!selected) throw new Error(`Unsupported Electron proximity platform: ${process.platform}`);

const result = spawnSync(selected[0], selected[1], {
  cwd: projectRoot,
  stdio: 'inherit',
});
if (result.error) throw result.error;
if (result.status !== 0) process.exit(result.status ?? 1);
