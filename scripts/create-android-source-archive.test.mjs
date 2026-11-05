import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { createAndroidSourceArchive } from './create-android-source-archive.mjs';

function run(command, args, cwd) {
  const result = spawnSync(command, args, { cwd, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout;
}

test('source archives contain working-tree changes without dependencies, outputs, or Git metadata', () => {
  const directory = mkdtempSync(join(tmpdir(), 'psstpsst-source-archive-'));
  const source = join(directory, 'source');
  const extracted = join(directory, 'extracted');
  const archive = join(directory, 'source.tar');
  try {
    mkdirSync(source);
    mkdirSync(extracted);
    run('git', ['init', '-q', '-b', 'master'], source);
    writeFileSync(join(source, '.gitignore'), 'node_modules/\nandroid/\nrelease/\n');
    writeFileSync(join(source, 'tracked.js'), 'staged source');
    writeFileSync(join(source, 'deleted.js'), 'deleted source');
    run('git', ['add', '.gitignore', 'tracked.js', 'deleted.js'], source);
    writeFileSync(join(source, '.gitignore'), 'node_modules/\nandroid/\nrelease/\ntracked.js\n');
    writeFileSync(join(source, 'tracked.js'), 'working-tree source');
    rmSync(join(source, 'deleted.js'));
    writeFileSync(join(source, 'new file.js'), 'new source');
    for (const name of ['node_modules', 'android', 'release']) {
      mkdirSync(join(source, name));
      writeFileSync(join(source, name, 'stale-cache'), 'must not enter clean builds');
    }
    createAndroidSourceArchive(source, archive);
    const entries = run('tar', ['-tf', archive], source).trim().split('\n').sort();
    assert.deepEqual(entries, ['./.gitignore', './new file.js', './tracked.js']);
    run('tar', ['-xf', archive, '-C', extracted], source);
    assert.equal(readFileSync(join(extracted, 'tracked.js'), 'utf8'), 'working-tree source');
    assert.throws(() => createAndroidSourceArchive(source, join(source, 'self.tar')), /outside/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('container launcher mounts a clean archive, passes the commit timestamp, and removes the snapshot', () => {
  const directory = mkdtempSync(join(tmpdir(), 'psstpsst-container-source-'));
  const root = fileURLToPath(new URL('../', import.meta.url));
  const argsFile = join(directory, 'docker-args.json');
  const filesFile = join(directory, 'sources.txt');
  try {
    const sdkArchives = join(directory, 'sdk-archives');
    mkdirSync(sdkArchives);
    const npmCache = join(directory, 'npm-cache');
    mkdirSync(join(npmCache, '_cacache'), { recursive: true });
    writeFileSync(join(directory, 'docker'), `#!/usr/bin/env node
const fs = require('node:fs');
const { spawnSync } = require('node:child_process');
const args = process.argv.slice(2);
fs.writeFileSync(process.env.TEST_DOCKER_ARGS, JSON.stringify(args));
const cidfile = args[args.indexOf('--cidfile') + 1];
fs.writeFileSync(cidfile, 'test-build-container');
const mount = args.find((arg) => arg.includes('dst=/source.tar'));
const archive = mount.split(',').find((part) => part.startsWith('src=')).slice(4);
const bootstrapMount = args.find((arg) => arg.includes('dst=/build-android.sh'));
const bootstrap = bootstrapMount.split(',').find((part) => part.startsWith('src=')).slice(4);
const archivedBootstrap = spawnSync('tar', ['-xOf', archive, './scripts/build-android-reproducible.sh']);
if (!archivedBootstrap.stdout.equals(fs.readFileSync(bootstrap))) process.exit(98);
const listing = spawnSync('tar', ['-tf', archive], { encoding: 'utf8' });
fs.writeFileSync(process.env.TEST_SOURCE_FILES, listing.stdout);
process.exit(Number(process.env.TEST_DOCKER_STATUS || listing.status));
`, { mode: 0o755 });
    const result = spawnSync('bash', [join(root, 'scripts/build-android-reproducible.sh'), join(directory, 'output')], {
      cwd: root, encoding: 'utf8', env: {
        ...process.env,
        TMPDIR: directory,
        PATH: `${directory}:${process.env.PATH}`,
        TEST_DOCKER_ARGS: argsFile,
        TEST_SOURCE_FILES: filesFile,
        ANDROID_SDK_ARCHIVES: sdkArchives,
        ANDROID_NPM_CACHE: npmCache,
        SOURCE_DATE_EPOCH: '',
        PSSTPSST_FDROID_CONTAINER: '',
      },
    });
    assert.equal(result.status, 0, result.stderr);
    const args = JSON.parse(readFileSync(argsFile, 'utf8'));
    const timestamp = run('git', ['show', '-s', '--format=%ct', 'HEAD'], root).trim();
    assert.ok(args.includes(`SOURCE_DATE_EPOCH=${timestamp}`));
    assert.ok(args.includes(`type=bind,src=${sdkArchives},dst=/sdk-archives,readonly`));
    assert.ok(args.includes(`type=bind,src=${npmCache}/_cacache,dst=/npm-download-cache,readonly`));
    const archive = args.find((arg) => arg.includes('dst=/source.tar')).split(',').find((part) => part.startsWith('src=')).slice(4);
    assert.ok(!existsSync(archive));
    const files = readFileSync(filesFile, 'utf8').trim().split('\n');
    assert.ok(files.includes('./package.json'));
    assert.ok(files.includes('./scripts/build-android-artifacts.sh'));
    assert.ok(!files.some((file) => /^\.\/(?:node_modules|android|ios|release|\.git)\//.test(file)));
    const failed = spawnSync('bash', [join(root, 'scripts/build-android-reproducible.sh'), join(directory, 'output')], {
      cwd: root, encoding: 'utf8', env: {
        ...process.env,
        TMPDIR: directory,
        PATH: `${directory}:${process.env.PATH}`,
        TEST_DOCKER_ARGS: argsFile,
        TEST_SOURCE_FILES: filesFile,
        TEST_DOCKER_STATUS: '17',
        ANDROID_KEEP_FAILED_CONTAINER: '1',
        SOURCE_DATE_EPOCH: '12345',
        PSSTPSST_FDROID_CONTAINER: '',
      },
    });
    assert.equal(failed.status, 17, failed.stderr);
    const failedArgs = JSON.parse(readFileSync(argsFile, 'utf8'));
    assert.ok(failedArgs.includes('SOURCE_DATE_EPOCH=12345'));
    assert.ok(!failedArgs.includes('--rm'));
    assert.equal(readFileSync(join(directory, 'output/container.id'), 'utf8'), 'test-build-container');
    const failedArchive = failedArgs.find((arg) => arg.includes('dst=/source.tar')).split(',').find((part) => part.startsWith('src=')).slice(4);
    assert.ok(existsSync(failedArchive));
    assert.ok(existsSync(join(dirname(failedArchive), 'build-android.sh')));
    assert.equal(readFileSync(join(directory, 'output/source-snapshot.path'), 'utf8').trim(), dirname(failedArchive));
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
