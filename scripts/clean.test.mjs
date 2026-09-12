import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';

test('cleanup removes artifacts while preserving source, configuration, and external files', () => {
  const temp = mkdtempSync(join(tmpdir(), 'mumble-clean-'));
  const root = join(temp, 'repo');
  const put = (name, content = 'fixture') => {
    const path = join(root, name);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, content);
  };
  const run = (args = []) => execFileSync(process.execPath, [join(root, 'scripts/clean.mjs'), ...args], {
    cwd: temp,
    encoding: 'utf8',
  });
  try {
    put('scripts/clean.mjs');
    copyFileSync(new URL('./clean.mjs', import.meta.url), join(root, 'scripts/clean.mjs'));
    copyFileSync(new URL('../.gitignore', import.meta.url), join(root, '.gitignore'));
    put('modules/example/android/.gitignore', '.cxx/\n');
    put('src/keep.ts');
    put('package-lock.json', '{}');
    put('dist/tracked.txt', 'original');
    execFileSync('git', ['init', '-q', root]);
    execFileSync('git', ['add', '-f', '.'], { cwd: root });
    put('dist/tracked.txt', 'edited');

    const removed = [
      'node_modules/pkg/index.js', 'desktop/node_modules/pkg/index.js',
      'modules/example/node_modules/pkg/index.js', '.expo/settings.json',
      'expo-env.d.ts', 'ios/Pods/file', 'android/app/build/file',
      'desktop/dist/main.js', 'dist/generated.js', 'web-build/index.html',
      'release/app.dmg', 'desktop/native/proximity/bin/darwin/helper',
      'desktop/native/proximity/linux/target/debug/helper',
      'modules/example/android/build/file', 'modules/example/android/.cxx/file',
      'coverage/lcov.info', 'scripts/__pycache__/test.pyc',
      'tsconfig.tsbuildinfo', '.metro-health-check-test', 'npm-debug.log',
    ];
    const preserved = [
      '.env', '.env.local', 'signing.key', '.vscode/settings.json',
      '.claude/settings.json', 'src/untracked.ts', '__debug_userdata__/data.db',
    ];
    removed.forEach((name) => put(name));
    preserved.forEach((name) => put(name));
    const external = join(temp, 'external');
    mkdirSync(external);
    writeFileSync(join(external, 'keep'), 'external');
    mkdirSync(join(root, 'modules/linked'), { recursive: true });
    symlinkSync(external, join(root, 'modules/linked/node_modules'), 'junction');

    run(['--dry-run']);
    removed.forEach((name) => assert.ok(existsSync(join(root, name)), `Preview deleted ${name}`));
    assert.equal(spawnSync(process.execPath, [join(root, 'scripts/clean.mjs'), '--unknown']).status, 1);
    run();
    removed.forEach((name) => assert.ok(!existsSync(join(root, name)), `Not removed: ${name}`));
    preserved.concat(['src/keep.ts', 'package-lock.json']).forEach((name) => {
      assert.ok(existsSync(join(root, name)), `Deleted: ${name}`);
    });
    assert.equal(readFileSync(join(root, 'dist/tracked.txt'), 'utf8'), 'edited');
    assert.ok(existsSync(join(external, 'keep')));
    // A directory-only ignore rule does not ignore a dependency symlink.
    assert.ok(existsSync(join(root, 'modules/linked/node_modules')));
    run();
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
});
