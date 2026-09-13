import { execFileSync } from 'node:child_process';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';

const require = createRequire(import.meta.url);
const identity = require('../config/app-identities.json').development;

/** macOS uses the host bundle's identity for permissions even in unbundled development. */
export async function prepareElectronDevRuntime(projectRoot, electronBinary) {
  if (process.platform !== 'darwin') return electronBinary;
  const runtimeRoot = path.join(projectRoot, 'desktop', '.dev-runtime');
  const bundle = path.join(runtimeRoot, `${identity.name}.app`);
  const marker = path.join(runtimeRoot, 'identity.json');
  const fingerprint = JSON.stringify({ version: require('electron/package.json').version, identity });
  try {
    if (await readFile(marker, 'utf8') === fingerprint) {
      return path.join(bundle, 'Contents', 'MacOS', 'Electron');
    }
  } catch { /* Prepare a fresh runtime when no completed copy exists. */ }

  await mkdir(runtimeRoot, { recursive: true });
  await rm(marker, { force: true });
  await rm(bundle, { recursive: true, force: true });
  execFileSync('ditto', [path.resolve(electronBinary, '../../..'), bundle]);
  const plist = path.join(bundle, 'Contents', 'Info.plist');
  for (const [key, value] of Object.entries({
    CFBundleIdentifier: identity.id,
    CFBundleName: identity.name,
    CFBundleDisplayName: identity.name,
  })) {
    execFileSync('plutil', ['-replace', key, '-string', value, plist]);
  }
  execFileSync('codesign', ['--force', '--deep', '--sign', '-', '--preserve-metadata=entitlements', bundle], {
    stdio: 'inherit',
  });
  await writeFile(marker, fingerprint);
  return path.join(bundle, 'Contents', 'MacOS', 'Electron');
}
