import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { findMissingReleaseAssets, RELEASE_ASSET_NAMES } from './release-assets.mjs';

const require = createRequire(import.meta.url);
const root = new URL('../', import.meta.url);

test('public release assets use stable version-independent names', () => {
  const desktop = require('../desktop/package.json');
  assert.equal(desktop.build.artifactName, '${productName}-${os}-${arch}.${ext}');
  assert.equal(new Set(RELEASE_ASSET_NAMES).size, RELEASE_ASSET_NAMES.length);
  for (const name of RELEASE_ASSET_NAMES) assert.doesNotMatch(name, /\d+\.\d+\.\d+/);

  const workflow = readFileSync(new URL('.github/workflows/build.yml', root), 'utf8');
  assert.match(workflow, /release\/PsstPsst-android\.apk/);
  assert.match(workflow, /node scripts\/release-assets\.mjs release-assets/);
  assert.doesNotMatch(workflow, /PsstPsst-\$\{version\}/);

  const zapstore = readFileSync(new URL('zapstore.yaml', root), 'utf8');
  const zapstoreMatch = zapstore.split('\n').find((line) => line.startsWith('match: '));
  assert.equal(zapstoreMatch, 'match: ^PsstPsst-android\\.apk$');
  const apkPattern = new RegExp(zapstoreMatch.slice('match: '.length));
  assert.ok(apkPattern.test('PsstPsst-android.apk'));
  assert.ok(!apkPattern.test('PsstPsst-0.2.3-android.apk'));
  assert.ok(!apkPattern.test('PsstPsst-preview-android.apk'));

  const fdroid = readFileSync(new URL('fdroid/metadata/chat.psstpsst.app.yml', root), 'utf8');
  assert.match(fdroid, /^Binaries: .+\/releases\/download\/v%v\/PsstPsst-android\.apk$/m);
  assert.doesNotMatch(fdroid, /PsstPsst-%v-android\.apk/);
});

test('release validation reports only missing assets', () => {
  const directory = mkdtempSync(join(tmpdir(), 'psstpsst-release-assets-'));
  try {
    for (const name of RELEASE_ASSET_NAMES.slice(1)) writeFileSync(join(directory, name), 'fixture');
    assert.deepEqual(findMissingReleaseAssets(directory), [RELEASE_ASSET_NAMES[0]]);
    mkdirSync(join(directory, RELEASE_ASSET_NAMES[0]));
    assert.deepEqual(findMissingReleaseAssets(directory), [RELEASE_ASSET_NAMES[0]]);
    rmSync(join(directory, RELEASE_ASSET_NAMES[0]), { recursive: true });
    writeFileSync(join(directory, RELEASE_ASSET_NAMES[0]), 'fixture');
    assert.deepEqual(findMissingReleaseAssets(directory), []);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
