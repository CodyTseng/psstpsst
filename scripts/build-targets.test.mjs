import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { planBuild } from './build-targets.mjs';

const disabled = { macos: 'none', windows: 'none', linux: 'none', android: 'none' };

test('tag builds always include every release target, regardless of manual inputs', () => {
  for (const signed of [false, true]) {
    const plan = planBuild('push', disabled, signed);
    assert.equal(plan.matrix.include.length, 5);
    for (const flag of ['desktop', 'macos', 'android', 'apk', 'aab']) assert.equal(plan[flag], true);
    assert.equal(new Set(plan.matrix.include.map(({ artifact }) => artifact)).size, 5);
  }
});

test('default manual builds use all and skip AAB without credentials', () => {
  for (const signed of [false, true]) {
    const plan = planBuild('workflow_dispatch', {}, signed);
    assert.equal(plan.matrix.include.length, 5);
    assert.equal(plan.apk, true);
    assert.equal(plan.aab, signed);
  }
});

test('manual platform and architecture combinations select only the requested targets', () => {
  for (const macos of ['none', 'arm64']) {
    for (const windows of ['none', 'x64', 'arm64', 'all']) {
      for (const linux of ['none', 'x64', 'arm64', 'all']) {
        for (const android of ['none', 'apk', 'aab', 'all']) {
          const inputs = { macos, windows, linux, android };
          if (Object.values(inputs).every((value) => value === 'none')) {
            assert.throws(() => planBuild('workflow_dispatch', inputs, true), /at least one/);
            continue;
          }
          const plan = planBuild('workflow_dispatch', inputs, true);
          const expected = [];
          if (macos !== 'none') expected.push('macOS arm64');
          for (const [platform, selection] of [['Windows', windows], ['Linux', linux]]) {
            for (const arch of ['x64', 'arm64']) {
              if (selection === 'all' || selection === arch) expected.push(`${platform} ${arch}`);
            }
          }
          assert.deepEqual(plan.matrix.include.map(({ name }) => name), expected);
          assert.equal(plan.desktop, expected.length > 0);
          assert.equal(plan.macos, macos !== 'none');
          assert.equal(plan.android, android !== 'none');
          assert.equal(plan.apk, ['apk', 'all'].includes(android));
          assert.equal(plan.aab, ['aab', 'all'].includes(android));
        }
      }
    }
  }
});

test('explicit AAB builds require credentials but unrelated platforms do not', () => {
  assert.throws(() => planBuild('workflow_dispatch', { ...disabled, android: 'aab' }), /signing credentials/);
  const plan = planBuild('workflow_dispatch', { ...disabled, windows: 'arm64' });
  assert.equal(plan.android, false);
  assert.equal(plan.macos, false);
  assert.deepEqual(plan.matrix.include.map(({ name }) => name), ['Windows arm64']);
});

test('manual Android all builds APK and includes AAB only with credentials', () => {
  for (const signed of [false, true]) {
    const plan = planBuild('workflow_dispatch', { ...disabled, android: 'all' }, signed);
    assert.equal(plan.desktop, false);
    assert.equal(plan.android, true);
    assert.equal(plan.apk, true);
    assert.equal(plan.aab, signed);
  }
});

test('invalid inputs fail before allocating build runners', () => {
  assert.throws(() => planBuild('workflow_dispatch', { android: 'auto' }, true), /Invalid android/);
  for (const platform of Object.keys(disabled)) {
    assert.throws(() => planBuild('workflow_dispatch', { [platform]: 'unexpected' }, true), /Invalid/);
  }
});

test('CLI writes reusable GitHub outputs for an Android-only selection', () => {
  const dir = mkdtempSync(join(tmpdir(), 'psstpsst-build-targets-'));
  try {
    const eventPath = join(dir, 'event.json');
    const outputPath = join(dir, 'output');
    writeFileSync(eventPath, JSON.stringify({ inputs: { ...disabled, android: 'aab' } }));
    const result = spawnSync(process.execPath, ['scripts/build-targets.mjs'], {
      env: { ...process.env, GITHUB_EVENT_NAME: 'workflow_dispatch', GITHUB_EVENT_PATH: eventPath,
        GITHUB_OUTPUT: outputPath, HAS_ANDROID_SIGNING: 'true' }, encoding: 'utf8',
    });
    assert.equal(result.status, 0, result.stderr);
    const outputs = Object.fromEntries(readFileSync(outputPath, 'utf8').trim().split('\n')
      .map((line) => [line.slice(0, line.indexOf('=')), line.slice(line.indexOf('=') + 1)]));
    assert.deepEqual(JSON.parse(outputs.matrix), { include: [] });
    assert.equal(outputs.desktop, 'false');
    assert.equal(outputs.android, 'true');
    assert.equal(outputs.apk, 'false');
    assert.equal(outputs.aab, 'true');
    assert.match(result.stdout, /Selected builds: Android AAB/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
