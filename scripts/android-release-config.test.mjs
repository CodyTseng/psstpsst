import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

const require = createRequire(import.meta.url);
const { configureReleaseBuild } = require('../plugins/with-android-release');
const { expo } = require('../app.json');
const withAndroidRelease = require('../plugins/with-android-release');

async function runMod(name, results, request = {}) {
  const config = withAndroidRelease({ name: 'Test', slug: 'test' });
  const modified = await config.mods.android[name]({
    ...config,
    modResults: results,
    modRequest: { platform: 'android', modName: name, ...request },
  });
  return modified.modResults;
}

test('release prebuild keeps optimized R8 rules and ABI configuration without duplication', () => {
  const original = 'android { buildTypes { release { proguardFiles getDefaultProguardFile("proguard-android.txt"), "proguard-rules.pro" } } }\n';
  const configured = configureReleaseBuild(original);
  assert.ok(configured.startsWith(original.replace('proguard-android.txt', 'proguard-android-optimize.txt')));
  assert.equal(configureReleaseBuild(configured), configured);
  assert.equal(configureReleaseBuild(configured.replace("'psstpsstAbiSplits'", "'outdatedProperty'")), configured);
  assert.throws(() => configureReleaseBuild('// PsstPsst Android ABI outputs\n'), /--clean/);
  assert.ok(expo.plugins.includes('./plugins/with-android-release'));
  const [, properties] = expo.plugins.find((plugin) => Array.isArray(plugin) && plugin[0] === 'expo-build-properties');
  assert.equal(properties.android.enableMinifyInReleaseBuilds, true);
  assert.equal(properties.android.enableShrinkResourcesInReleaseBuilds, true);
});

test('development prebuild leaves Metro host discovery available', async () => {
  const previous = process.env.EXPO_PUBLIC_APP_ENV;
  try {
    process.env.EXPO_PUBLIC_APP_ENV = 'development';
    const properties = await runMod('gradleProperties', []);
    assert.ok(!properties.some((item) => item.key === 'reactNativeDevServerIp'));
    const existing = await runMod('gradleProperties', [
      { type: 'property', key: 'reactNativeDevServerIp', value: '127.0.0.1' },
    ]);
    assert.ok(!existing.some((item) => item.key === 'reactNativeDevServerIp'));
    const custom = await runMod('gradleProperties', [
      { type: 'property', key: 'reactNativeDevServerIp', value: '192.168.1.10' },
    ]);
    assert.equal(custom.find((item) => item.key === 'reactNativeDevServerIp').value, '192.168.1.10');
  } finally {
    if (previous === undefined) delete process.env.EXPO_PUBLIC_APP_ENV;
    else process.env.EXPO_PUBLIC_APP_ENV = previous;
  }
});

test('clean prebuild declares a portable Java 21 Gradle runtime', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'psstpsst-daemon-jvm-'));
  try {
    await runMod('dangerous', undefined, { platformProjectRoot: directory });
    assert.equal(readFileSync(join(directory, 'gradle/gradle-daemon-jvm.properties'), 'utf8'), 'toolchainVersion=21\n');
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('prebuild preserves template or developer JVM and concurrency settings', async () => {
  const properties = [
    { type: 'property', key: 'org.gradle.jvmargs', value: '-Xmx2048m -XX:MaxMetaspaceSize=512m' },
    { type: 'property', key: 'kotlin.daemon.jvmargs', value: '-Xmx2048m' },
    { type: 'property', key: 'org.gradle.workers.max', value: '6' },
  ];
  const keys = new Set(properties.map(item => item.key));
  const updated = await runMod('gradleProperties', structuredClone(properties));
  assert.deepEqual(updated.filter(item => keys.has(item.key)), properties);
  const defaults = await runMod('gradleProperties', []);
  assert.ok(!defaults.some(item => keys.has(item.key)));
  assert.equal(updated.find((item) => item.key === 'reactNativeDevServerIp').value, '127.0.0.1');
  assert.deepEqual(await runMod('gradleProperties', structuredClone(updated)), updated);
});

test('clean prebuild preserves the Android bytecode target and unsigned release configuration', async () => {
  const root = await runMod('projectBuildGradle', { language: 'groovy', contents: '// template\n' });
  assert.ok(root.contents.includes('JvmTarget.JVM_17'));
  assert.ok(root.contents.includes('library.ndkVersion = rootProject.ext.ndkVersion'));
  const previous = root.contents.replaceAll('PsstPsst Android toolchain', 'PsstPsst Kotlin bytecode target');
  assert.deepEqual(await runMod('projectBuildGradle', { ...root, contents: previous }), root);
  assert.deepEqual(await runMod('projectBuildGradle', structuredClone(root)), root);
  const app = await runMod('appBuildGradle', { language: 'groovy', contents: '// template\n' });
  assert.ok(app.contents.includes('psstpsstDebugSigning'));
  assert.ok(app.contents.includes('android.signingConfigs.debug : null'));
});

test('CI prebuild disables Gradle file watching', async () => {
  const previous = process.env.CI;
  try {
    process.env.CI = '1';
    const properties = await runMod('gradleProperties', []);
    assert.equal(properties.find((item) => item.key === 'org.gradle.vfs.watch').value, 'false');
  } finally {
    if (previous === undefined) delete process.env.CI;
    else process.env.CI = previous;
  }
});
