import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { prepareElectronDevRuntime } from './electron-dev-runtime.mjs';

const require = createRequire(import.meta.url);
const projectRoot = fileURLToPath(new URL('../', import.meta.url));
const binary = await prepareElectronDevRuntime(projectRoot, require('electron'));
const child = spawn(binary, [fileURLToPath(new URL('../desktop/dist/main.js', import.meta.url))], {
  cwd: projectRoot,
  stdio: 'inherit',
});
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, () => child.kill(signal));
}
child.once('error', (error) => { console.error(error); process.exitCode = 1; });
child.once('exit', (code) => { process.exitCode = code ?? 1; });
