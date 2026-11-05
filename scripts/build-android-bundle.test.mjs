import assert from 'node:assert/strict';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { buildAndroidBundle } from './build-android-bundle.mjs';

for (const exitCode of [0, 1]) {
  test(`bundle build leaves Gradle configuration untouched after exiting with ${exitCode}`, () => {
    const dir = mkdtempSync(join(tmpdir(), 'psstpsst-bundle-build-'));
    try {
      const gradlePath = join(dir, 'app', 'build.gradle');
      const original = 'android {\n  buildTypes {\n    debug {\n      signingConfig signingConfigs.debug\n    }\n    release {\n      signingConfig signingConfigs.debug\n    }\n  }\n}\n';
      mkdirSync(join(dir, 'app'));
      writeFileSync(gradlePath, original);
      const output = join(dir, 'app', 'build', 'outputs', 'bundle', 'release', 'app-release.aab');
      mkdirSync(join(output, '..'), { recursive: true });
      writeFileSync(output, 'stale bundle');
      const wrapper = join(dir, 'gradlew');
      writeFileSync(wrapper, `#!/bin/sh
test "$1" = ':app:bundleRelease' || exit 2
test "$EXPO_PUBLIC_APP_ENV" = production || exit 2
test "$2" = '-PpsstpsstDebugSigning=false' || exit 2
test "$3" = '-PpsstpsstAbiSplits=false' || exit 2
test ! -f app/build/outputs/bundle/release/app-release.aab || exit 2
cp app/build.gradle during-build.gradle
echo fixture > app/build/outputs/bundle/release/app-release.aab
exit ${exitCode}
`);
      chmodSync(wrapper, 0o755);
      if (exitCode === 0) buildAndroidBundle(dir);
      else assert.throws(() => buildAndroidBundle(dir), /exit 1/);
      assert.equal(readFileSync(gradlePath, 'utf8'), original);
      const duringBuild = readFileSync(join(dir, 'during-build.gradle'), 'utf8');
      assert.match(duringBuild, /debug \{\n      signingConfig signingConfigs.debug/);
      assert.equal(duringBuild, original);
      assert.equal(existsSync(output), exitCode === 0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
}

test('bundle build requires a generated Android project', () => {
  const dir = mkdtempSync(join(tmpdir(), 'psstpsst-bundle-config-'));
  try {
    assert.throws(() => buildAndroidBundle(dir), /android:prebuild/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
