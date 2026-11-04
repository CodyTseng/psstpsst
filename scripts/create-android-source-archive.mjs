import { spawnSync } from 'node:child_process';
import { lstatSync } from 'node:fs';
import { relative, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';

export function createAndroidSourceArchive(directory, archive) {
  const root = resolve(directory);
  const output = resolve(archive);
  if (!relative(root, output).startsWith(`..${sep}`)) {
    throw new Error('Create the Android source archive outside the working tree.');
  }
  // Include staged, modified, and new source files, while excluding ignored dependencies and outputs.
  const listing = spawnSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], {
    cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024,
  });
  if (listing.error) throw listing.error;
  if (listing.status !== 0) throw new Error(`Cannot list Android build sources: ${listing.stderr}`);
  const files = listing.stdout.split('\0').filter(Boolean).filter((file) => {
    try {
      lstatSync(resolve(root, file));
      return true;
    } catch (error) {
      if (error.code === 'ENOENT') return false;
      throw error;
    }
  });
  if (!files.length) throw new Error('Android build source archive would be empty.');
  const result = spawnSync('tar', ['-C', root, '--null', '-T', '-', '-cf', output], {
    input: files.map((file) => `./${file}\0`).join(''), encoding: 'utf8',
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`Cannot archive Android build sources: ${result.stderr}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    if (process.argv.length !== 4) throw new Error('Usage: create-android-source-archive.mjs <repository> <archive>');
    createAndroidSourceArchive(process.argv[2], process.argv[3]);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
