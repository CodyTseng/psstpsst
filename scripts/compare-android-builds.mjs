import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export const ANDROID_APKS = [
  'app-release.apk',
  ...['armeabi-v7a', 'arm64-v8a', 'x86', 'x86_64'].map((abi) => `app-${abi}-release.apk`),
];

async function digest(path) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest('hex');
}

export async function compareAndroidBuilds(first, second) {
  if (!first || !second || resolve(first) === resolve(second)) {
    throw new Error('Provide two distinct Android build directories.');
  }
  for (const name of ANDROID_APKS) {
    const expected = await digest(join(first, name));
    const actual = await digest(join(second, name));
    if (actual !== expected) throw new Error(`Independent Android rebuild differs: ${name}`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    if (process.argv.length !== 4) throw new Error('Usage: compare-android-builds.mjs <first-build> <second-build>');
    await compareAndroidBuilds(process.argv[2], process.argv[3]);
    console.log('All five APKs match the independent rebuild byte for byte.');
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
