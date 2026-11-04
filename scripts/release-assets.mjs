import { statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export const RELEASE_ASSET_NAMES = Object.freeze([
  'PsstPsst-android-universal.apk',
  'PsstPsst-android-arm32.apk',
  'PsstPsst-android-arm64.apk',
  'PsstPsst-android-x86.apk',
  'PsstPsst-android-x64.apk',
  'PsstPsst-android.aab',
  'latest-mac.yml',
  'latest-x64.yml',
  'latest-arm64.yml',
  'latest-linux.yml',
  'latest-linux-arm64.yml',
  'PsstPsst-mac-arm64.dmg',
  'PsstPsst-mac-arm64.dmg.blockmap',
  'PsstPsst-mac-arm64.zip',
  'PsstPsst-mac-arm64.zip.blockmap',
  'PsstPsst-win-x64.exe',
  'PsstPsst-win-x64.exe.blockmap',
  'PsstPsst-win-arm64.exe',
  'PsstPsst-win-arm64.exe.blockmap',
  'PsstPsst-linux-x86_64.AppImage',
  'PsstPsst-linux-amd64.deb',
  'PsstPsst-linux-arm64.AppImage',
  'PsstPsst-linux-arm64.deb',
]);

export function findMissingReleaseAssets(directory) {
  return RELEASE_ASSET_NAMES.filter((name) => {
    try {
      const artifact = statSync(join(directory, name));
      return !artifact.isFile() || artifact.size === 0;
    } catch {
      return true;
    }
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const directory = process.argv[2];
  if (!directory) {
    console.error('Usage: release-assets.mjs <asset-directory>');
    process.exitCode = 2;
  } else {
    for (const asset of findMissingReleaseAssets(directory)) {
      console.error(`::error file=${join(directory, asset)}::Required release asset is missing.`);
      process.exitCode = 1;
    }
  }
}
