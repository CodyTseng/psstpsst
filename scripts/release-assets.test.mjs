import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { findMissingReleaseAssets, RELEASE_ASSET_NAMES } from './release-assets.mjs';

const require = createRequire(import.meta.url);
const root = new URL('../', import.meta.url);
const yaml = require('js-yaml');

test('public release assets use stable version-independent names', () => {
  const desktop = require('../desktop/package.json');
  assert.equal(desktop.build.artifactName, '${productName}-${os}-${arch}.${ext}');
  assert.equal(new Set(RELEASE_ASSET_NAMES).size, RELEASE_ASSET_NAMES.length);
  for (const name of RELEASE_ASSET_NAMES) assert.doesNotMatch(name, /\d+\.\d+\.\d+/);

  const workflow = readFileSync(new URL('.github/workflows/build.yml', root), 'utf8');
  assert.match(workflow, /release\/PsstPsst-android-universal\.apk/);
  assert.match(workflow, /release\/PsstPsst-android\.aab/);
  assert.ok(RELEASE_ASSET_NAMES.includes('PsstPsst-android.aab'));
  assert.match(workflow, /name: android-aab/);
  assert.match(workflow, /node scripts\/release-assets\.mjs release-assets/);
  assert.doesNotMatch(workflow, /PsstPsst-\$\{version\}/);

  const zapstore = readFileSync(new URL('zapstore.yaml', root), 'utf8');
  const zapstoreMatch = zapstore.split('\n').find((line) => line.startsWith('match: '));
  assert.equal(zapstoreMatch, 'match: ^PsstPsst-android-universal\\.apk$');
  const apkPattern = new RegExp(zapstoreMatch.slice('match: '.length));
  assert.ok(apkPattern.test('PsstPsst-android-universal.apk'));
  assert.ok(!apkPattern.test('PsstPsst-0.2.3-android.apk'));
  assert.ok(!apkPattern.test('PsstPsst-preview-android.apk'));
  for (const name of RELEASE_ASSET_NAMES.filter((asset) => asset.endsWith('.apk'))) {
    assert.equal(apkPattern.test(name), name === 'PsstPsst-android-universal.apk');
  }

  const fdroid = readFileSync(new URL('fdroid/metadata/chat.psstpsst.app.yml', root), 'utf8');
  assert.doesNotMatch(fdroid, /^Binaries:/m);
  for (const build of yaml.load(fdroid).Builds) {
    const asset = build.binary.split('/').at(-1);
    assert.ok(RELEASE_ASSET_NAMES.includes(asset), `Missing reference binary ${asset}`);
  }
  assert.doesNotMatch(fdroid, /PsstPsst-%v-android\.apk/);
});

test('F-Droid auditing cannot block the normal APK release', () => {
  const workflow = readFileSync(new URL('.github/workflows/build.yml', root), 'utf8');
  const uploadIndex = workflow.indexOf('      - name: Upload APK');
  const auditIndex = workflow.indexOf('      - name: Audit F-Droid signature compatibility (non-blocking)');
  const reportIndex = workflow.indexOf('      - name: Report F-Droid audit failure');
  assert.ok(uploadIndex >= 0 && auditIndex > uploadIndex && reportIndex > auditIndex);

  const audit = workflow.slice(auditIndex, reportIndex);
  assert.match(audit, /^        continue-on-error: true$/m);
  assert.match(audit, /^        timeout-minutes: 5$/m);
  assert.match(workflow.slice(reportIndex), /the APK was already uploaded and the release will continue/);
});

test('credentialed APK releases compare independent unsigned builds before signing', () => {
  const workflow = readFileSync(new URL('.github/workflows/build.yml', root), 'utf8');
  const compareIndex = workflow.indexOf('      - name: Verify independent APK rebuild');
  const signIndex = workflow.indexOf('      - name: Sign and verify APK');
  assert.ok(compareIndex >= 0 && compareIndex < signIndex);
  const comparison = workflow.slice(compareIndex, signIndex);
  assert.match(comparison, /ANDROID_RELEASE_UNSIGNED: '1'/);
  assert.match(comparison, /scripts\/compare-android-builds\.mjs release\/fdroid-build release\/fdroid-rebuild/);
  assert.doesNotMatch(comparison, /continue-on-error/);
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
    writeFileSync(join(directory, RELEASE_ASSET_NAMES[0]), '');
    assert.deepEqual(findMissingReleaseAssets(directory), [RELEASE_ASSET_NAMES[0]]);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('F-Droid ABI builds select matching binaries and increasing version codes', () => {
  const metadata = yaml.load(readFileSync(new URL('fdroid/metadata/chat.psstpsst.app.yml', root), 'utf8'));
  const counter = require('../app.json').expo.android.versionCode;
  const abis = ['armeabi-v7a', 'arm64-v8a', 'x86', 'x86_64'];
  const architectures = ['arm32', 'arm64', 'x86', 'x64'];
  assert.equal(metadata.Builds.length, abis.length);
  assert.equal(metadata.CurrentVersionCode, counter * 10 + abis.length);
  for (const [index, abi] of abis.entries()) {
    const build = metadata.Builds[index];
    assert.equal(build.versionCode, counter * 10 + index + 1);
    assert.ok(build.versionCode < (counter + 1) * 10);
    assert.equal(metadata.VercodeOperation[index], `10 * %c + ${index + 1}`);
    assert.equal(build.binary.split('/').at(-1), `PsstPsst-android-${architectures[index]}.apk`);
    assert.equal(build.output, `android/app/build/outputs/apk/release/app-${abi}-release-unsigned.apk`);
    const assemble = build.build.find((command) => command.includes(':app:assembleRelease'));
    assert.ok(assemble.includes(`-PreactNativeArchitectures=${abi} `));
    assert.ok(assemble.includes('-PpsstpsstAbiSplits=true'));
    assert.ok(build.scandelete.includes('android/app/debug.keystore'));
    assert.ok(build.init.some((command) => command.endsWith('npm run android:prebuild')));
    assert.ok(!build.sudo.some((command) => /bookworm|openjdk-17|curl/.test(command)));
    assert.ok(!build.build.some((command) => /JAVA_HOME|sed /.test(command)));
  }
});
