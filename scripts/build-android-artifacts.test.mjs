import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const abis = ['universal', 'armeabi-v7a', 'arm64-v8a', 'x86', 'x86_64'];
const builder = fileURLToPath(new URL('./build-android-artifacts.sh', import.meta.url));

function fixture(options, verify) {
  const directory = mkdtempSync(join(tmpdir(), 'psstpsst-android-artifacts-'));
  try {
    for (const name of ['scripts', 'android', 'bin']) mkdirSync(join(directory, name));
    copyFileSync(builder, join(directory, 'scripts/build-android-artifacts.sh'));
    writeFileSync(join(directory, 'scripts/check-android-apk.py'), '');
    const mock = `#!/usr/bin/env node
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const args = process.argv.slice(2);
const tool = path.basename(process.argv[1]);
const event = { tool, args };
fs.appendFileSync(process.env.TEST_EVENTS, JSON.stringify(event) + '\\n');
if (tool === 'gradle') {
  const targets = args.filter(arg => [':app:assembleRelease', ':app:bundleRelease'].includes(arg));
  assert.equal(targets.length, 1, 'APK and AAB require independent variant configurations');
  if (targets[0] === ':app:assembleRelease') {
    assert.ok(args.includes('-PpsstpsstAbiSplits=true'));
    const output = 'app/build/outputs/apk/release';
    fs.mkdirSync(output, { recursive: true });
    const signed = args.includes('-PpsstpsstDebugSigning=true');
    for (const abi of ['universal', 'armeabi-v7a', 'arm64-v8a', 'x86', 'x86_64']) {
      fs.writeFileSync(path.join(output, 'app-' + abi + '-release' + (signed ? '' : '-unsigned') + '.apk'), 'APK:' + abi);
    }
  } else {
    assert.ok(args.includes('-PpsstpsstAbiSplits=false'));
    assert.ok(!args.includes('-PpsstpsstDebugSigning=true'));
    // Switching the variant may invalidate APK outputs; staged APKs must survive.
    fs.rmSync('app/build/outputs/apk', { recursive: true, force: true });
    fs.mkdirSync('app/build/outputs/bundle/release', { recursive: true });
    fs.writeFileSync('app/build/outputs/bundle/release/app-release.aab', 'AAB');
  }
} else {
  assert.equal(tool, 'python3');
  assert.equal(args[0], 'scripts/check-android-apk.py');
  assert.ok(fs.statSync(args[1]).size > 0);
  if (process.env.TEST_CHECK_FAILURE) process.exit(Number(process.env.TEST_CHECK_FAILURE));
}
`;
    for (const name of ['gradle', 'python3']) writeFileSync(join(directory, 'bin', name), mock, { mode: 0o755 });
    const eventsFile = join(directory, 'events.jsonl');
    writeFileSync(eventsFile, '');
    const result = spawnSync('bash', ['scripts/build-android-artifacts.sh'], {
      cwd: directory, encoding: 'utf8', env: {
        ...process.env,
        PATH: `${join(directory, 'bin')}:${process.env.PATH}`,
        TEST_EVENTS: eventsFile,
        TEST_CHECK_FAILURE: '',
        ANDROID_BUILD_APK: '1',
        ANDROID_BUILD_BUNDLE: '0',
        ANDROID_RELEASE_UNSIGNED: '1',
        ...options,
      },
    });
    const events = readFileSync(eventsFile, 'utf8').trim().split('\n').filter(Boolean).map(line => JSON.parse(line));
    verify(result, events, join(directory, 'release/android-artifacts'));
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

test('combined releases stage all verified APKs before building the bundle without ABI splits', () => {
  fixture({ ANDROID_BUILD_BUNDLE: '1' }, (result, events, output) => {
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(events.map(event => event.tool), ['gradle', ...abis.map(() => 'python3'), 'gradle', 'python3']);
    for (const event of events.filter(event => event.tool === 'gradle')) {
      assert.ok(event.args.includes('--no-daemon'));
      assert.ok(!event.args.some(arg => arg.startsWith('--max-workers') || arg.startsWith('-Dorg.gradle.jvmargs=')));
    }
    for (const [index, abi] of abis.entries()) {
      const name = abi === 'universal' ? 'app-release.apk' : `app-${abi}-release.apk`;
      assert.equal(readFileSync(join(output, name), 'utf8'), `APK:${abi}`);
      assert.deepEqual(events[index + 1].args.slice(2), abi === 'universal' ? [] : [abi]);
    }
    assert.equal(readFileSync(join(output, 'app-release.aab'), 'utf8'), 'AAB');
  });
});

test('APK testing builds preserve debug signing without selecting a bundle', () => {
  fixture({ ANDROID_RELEASE_UNSIGNED: '0' }, (result, events) => {
    assert.equal(result.status, 0, result.stderr);
    const builds = events.filter(event => event.tool === 'gradle');
    assert.equal(builds.length, 1);
    assert.ok(builds[0].args.includes('-PpsstpsstDebugSigning=true'));
    assert.equal(events.filter(event => event.tool === 'python3').length, 5);
  });
});

test('bundle-only builds disable ABI splits and verify the staged AAB', () => {
  fixture({ ANDROID_BUILD_APK: '0', ANDROID_BUILD_BUNDLE: '1' }, (result, events, output) => {
    assert.equal(result.status, 0, result.stderr);
    assert.equal(events.length, 2);
    assert.ok(events[0].args.includes(':app:bundleRelease'));
    assert.equal(readFileSync(join(output, 'app-release.aab'), 'utf8'), 'AAB');
  });
});

test('an APK verification failure stops the build before bundle generation', () => {
  fixture({ ANDROID_BUILD_BUNDLE: '1', TEST_CHECK_FAILURE: '23' }, (result, events) => {
    assert.equal(result.status, 23, result.stderr);
    assert.deepEqual(events.map(event => event.tool), ['gradle', 'python3']);
  });
});
