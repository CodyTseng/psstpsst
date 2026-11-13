import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
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

test('Android releases build packages once before signing', () => {
  const workflow = yaml.load(readFileSync(new URL('.github/workflows/build.yml', root), 'utf8'));
  const steps = workflow.jobs['build-android'].steps;
  const builds = steps.filter(step => step.run?.includes('bash scripts/build-android-reproducible.sh'));
  assert.equal(builds.length, 1);
  assert.match(builds[0].run, /scripts\/build-android-reproducible\.sh release\/fdroid-build/);
  const signing = steps.find(step => step.name === 'Sign and verify APK');
  assert.ok(steps.indexOf(signing) > steps.indexOf(builds[0]));
  assert.match(signing.run, /release\/fdroid-build\/app-release\.apk/);
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


function withAndroidReleaseNotes(counter, check) {
  const directory = mkdtempSync(join(tmpdir(), 'psstpsst-release-notes-'));
  try {
    writeFileSync(join(directory, 'app.json'), JSON.stringify({ expo: { android: { versionCode: counter } } }));
    const notesDirectory = join(directory, 'fastlane/metadata/android/en-US/changelogs');
    mkdirSync(notesDirectory, { recursive: true });
    for (let suffix = 0; suffix <= 4; suffix++) writeFileSync(join(notesDirectory, `${counter * 10 + suffix}.txt`), 'Release notes\n');
    const workflow = yaml.load(readFileSync(new URL('.github/workflows/build.yml', root), 'utf8'));
    const step = workflow.jobs['validate-version'].steps.find(step => step.name === 'Match tag to desktop and Android versions');
    // Execute the actual Android validation block without the Linux-only repository-name check.
    const start = step.run.indexOf('base_version_code=');
    assert.ok(start >= 0, 'The release preflight must validate installed Android version codes.');
    const validate = () => spawnSync('bash', ['-e', '-o', 'pipefail', '-c', step.run.slice(start)], {
      cwd: directory, encoding: 'utf8', env: { ...process.env, LC_ALL: 'en_US.UTF-8' },
    });
    check({ notesDirectory, validate });
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

for (const counter of [14, 27]) {
  test(`release preflight accepts installed Android codes for counter ${counter} without a base-counter changelog`, () => {
    withAndroidReleaseNotes(counter, ({ validate }) => {
      const result = validate();
      assert.equal(result.status, 0, result.stdout + result.stderr);
    });
  });
}

for (const suffix of [0, 1, 2, 3, 4]) {
  test(`release preflight rejects a missing Android changelog for suffix ${suffix}`, () => {
    withAndroidReleaseNotes(14, ({ notesDirectory, validate }) => {
      // A legacy counter-named file must never substitute for an installed version.
      writeFileSync(join(notesDirectory, '14.txt'), 'Legacy notes');
      rmSync(join(notesDirectory, `${140 + suffix}.txt`));
      const result = validate();
      assert.equal(result.status, 1);
      assert.ok(result.stdout.includes(`changelogs/${140 + suffix}.txt`));
    });
  });
}

for (const [name, text, error] of [
  ['empty', '', 'missing or empty'],
  ['whitespace-only', ' \n\t', 'missing or empty'],
  ['too long', 'a'.repeat(501), '500-character'],
]) {
  test(`release preflight rejects ${name} Android notes`, () => {
    withAndroidReleaseNotes(14, ({ notesDirectory, validate }) => {
      writeFileSync(join(notesDirectory, '144.txt'), text);
      const result = validate();
      assert.equal(result.status, 1);
      assert.ok(result.stdout.includes(error), result.stdout);
    });
  });
}

test('release preflight counts Unicode characters and accepts the 500-character limit', () => {
  withAndroidReleaseNotes(14, ({ notesDirectory, validate }) => {
    writeFileSync(join(notesDirectory, '140.txt'), '字'.repeat(500));
    const result = validate();
    assert.equal(result.status, 0, result.stdout + result.stderr);
  });
});
