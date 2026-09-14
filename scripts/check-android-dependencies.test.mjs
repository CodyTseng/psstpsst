import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const script = new URL('./check-android-dependencies.mjs', import.meta.url);

test('the release dependency guard detects direct and transitive remote push and ML Kit SDKs', () => {
  const directory = mkdtempSync(join(tmpdir(), 'psstpsst-dependency-test-'));
  const report = join(directory, 'dependencies.txt');
  const check = (body) => {
    writeFileSync(report, body);
    return spawnSync(process.execPath, [fileURLToPath(script), report], { encoding: 'utf8' }).status;
  };
  try {
    assert.equal(check('releaseRuntimeClasspath\n+--- project :expo-local-notifications\n'), 0);
    assert.equal(check('releaseRuntimeClasspath\n+--- io.github.zxing-cpp:android:3.0.2\n'), 0);
    for (const dependency of [
      'com.google.firebase:firebase-messaging:25.0.1',
      'com.google.firebase:firebase-messaging-ktx:24.0.0',
      'com.google.firebase:firebase-iid:21.1.0',
      'com.google.android.gms:play-services-cloud-messaging:17.1.0',
      'com.google.android.gms:play-services-code-scanner:16.1.0',
      'com.google.android.gms:play-services-mlkit-barcode-scanning:18.3.1',
      'com.google.mlkit:barcode-scanning:17.3.0',
      'com.google.mlkit:common:18.11.0',
      'androidx.camera:camera-mlkit-vision:1.6.0',
      'project :expo-notifications',
      'host.exp.exponent:expo.modules.notifications:57.0.0',
      'org.example:unresolved:1.0 FAILED',
    ]) {
      assert.equal(check(`releaseRuntimeClasspath\n|    +--- ${dependency}\n`), 1, dependency);
    }
    assert.equal(check('BUILD SUCCESSFUL\n'), 1);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
