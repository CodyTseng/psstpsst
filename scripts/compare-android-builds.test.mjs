import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { ANDROID_APKS, compareAndroidBuilds } from './compare-android-builds.mjs';

test('independent rebuild comparison requires every APK to match', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'psstpsst-rebuild-'));
  const first = join(directory, 'first');
  const second = join(directory, 'second');
  try {
    mkdirSync(first);
    mkdirSync(second);
    for (const name of ANDROID_APKS) {
      writeFileSync(join(first, name), `unsigned ${name}`);
      writeFileSync(join(second, name), `unsigned ${name}`);
    }
    await compareAndroidBuilds(first, second);
    const changed = ANDROID_APKS.at(-1);
    writeFileSync(join(second, changed), 'different compiler output');
    await assert.rejects(compareAndroidBuilds(first, second), /rebuild differs.*x86_64/);
    rmSync(join(second, changed));
    await assert.rejects(compareAndroidBuilds(first, second), /ENOENT/);
    await assert.rejects(compareAndroidBuilds(first, first), /distinct/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
