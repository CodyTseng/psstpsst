import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const script = fileURLToPath(new URL('./android-download-cache.sh', import.meta.url));

function put(root, name, contents = name) {
  const file = join(root, name);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, contents);
}

function sync(mode, cache, home, sdk) {
  const result = spawnSync('bash', [script, mode, cache, home, sdk], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
}

test('download caches round-trip into independent homes without compiled outputs or credentials', () => {
  const directory = mkdtempSync(join(tmpdir(), 'psstpsst-android-downloads-'));
  try {
    const first = join(directory, 'first');
    const second = join(directory, 'second');
    const sdk = join(directory, 'sdk');
    const cache = join(directory, 'cache');
    const inputs = [
      '.npm/_cacache/content-v2/package',
      '.cache/gradlew-fdroid/versions/9.3.1/bin/gradle',
      '.gradle/caches/modules-2/files-2.1/org.example/lib/1.0/hash/lib.jar',
    ];
    for (const name of inputs) put(first, name);
    put(first, '.npmrc', 'secret');
    put(first, '.gradle/gradle.properties', 'secret');
    put(first, '.gradle/caches/9.3.1/transforms/compiled', 'compiled');
    put(first, 'project/android/app/build/output.apk', 'compiled');
    put(sdk, 'ndk.zip');
    put(sdk, 'checksums.json');
    put(sdk, 'installed/tool');
    // A cold cache is valid; missing packages must remain downloadable by the build.
    sync('restore', cache, second, join(directory, 'second-sdk'));
    sync('save', cache, first, sdk);
    sync('restore', cache, second, join(directory, 'second-sdk'));
    for (const name of inputs) assert.equal(readFileSync(join(second, name), 'utf8'), name);
    for (const name of ['.npmrc', '.gradle/gradle.properties', '.gradle/caches/9.3.1', 'project']) {
      assert.ok(!existsSync(join(second, name)), name);
    }
    assert.equal(readFileSync(join(directory, 'second-sdk/ndk.zip'), 'utf8'), 'ndk.zip');
    assert.ok(!existsSync(join(directory, 'second-sdk/checksums.json')));
    assert.ok(!existsSync(join(directory, 'second-sdk/installed')));
    put(second, inputs[0], 'independent copy');
    assert.equal(readFileSync(join(first, inputs[0]), 'utf8'), inputs[0]);
    // A subsequent build contributes newly downloaded dependencies to the next restore.
    put(second, '.npm/_cacache/content-v2/new-package');
    sync('save', cache, second, join(directory, 'second-sdk'));
    sync('restore', cache, first, sdk);
    assert.ok(existsSync(join(first, '.npm/_cacache/content-v2/new-package')));
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
