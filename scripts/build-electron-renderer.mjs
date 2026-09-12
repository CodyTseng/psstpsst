import { execFileSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outputDirectory = path.join(projectRoot, 'desktop', 'dist', 'renderer');
const expoCli = path.join(projectRoot, 'node_modules', 'expo', 'bin', 'cli');

await fs.rm(outputDirectory, { recursive: true, force: true });
await fs.mkdir(outputDirectory, { recursive: true });

execFileSync(
  process.execPath,
  [expoCli, 'export', '--platform', 'web', '--output-dir', outputDirectory],
  { cwd: projectRoot, stdio: 'inherit' },
);

execFileSync(
  process.execPath,
  [
    expoCli,
    'export:embed',
    '--entry-file',
    'desktop/renderer.ts',
    '--platform',
    'web',
    '--bundle-output',
    path.join(outputDirectory, 'renderer.js'),
    '--assets-dest',
    outputDirectory,
    '--dev',
    'false',
    '--minify',
    'true',
  ],
  { cwd: projectRoot, stdio: 'inherit' },
);

const htmlPath = path.join(outputDirectory, 'index.html');
const html = await fs.readFile(htmlPath, 'utf8');
const desktopHtml = html.replace(
  /<script src="\/_expo\/static\/js\/web\/[^\"]+" defer><\/script>/,
  '<script src="/renderer.js" defer></script>',
);
if (desktopHtml === html) throw new Error('Unable to replace the Expo renderer entry');
await fs.writeFile(htmlPath, desktopHtml);
await fs.rm(path.join(outputDirectory, '_expo', 'static', 'js'), {
  recursive: true,
  force: true,
});
