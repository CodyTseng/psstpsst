import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));

test('Napp helpers build from a checkout path containing URL-encoded characters', () => {
  const directory = mkdtempSync(join(tmpdir(), 'psstpsst helpers #%-'));
  try {
    mkdirSync(join(directory, 'scripts'));
    mkdirSync(join(directory, 'src/lib'), { recursive: true });
    cpSync(join(root, 'scripts/generate-napp-helpers.mjs'), join(directory, 'scripts/generate-napp-helpers.mjs'));
    cpSync(join(root, 'src/lib/napp'), join(directory, 'src/lib/napp'), { recursive: true });
    symlinkSync(join(root, 'node_modules'), join(directory, 'node_modules'), 'junction');
    const outputs = [
      ['ui-styles', 'nappUiStyles'], ['pure-helpers', 'nappPureHelpers'],
      ['bootstrap', 'nappBootstrap'], ['nip07-sandbox', 'nappletNip07Sandbox'], ['ui', 'nappUi'],
    ];
    for (const [name] of outputs) rmSync(join(directory, `src/lib/napp/${name}.generated.ts`));
    // The generator resolves inputs relative to its module, independently of the caller's cwd.
    const result = spawnSync(process.execPath, [join(directory, 'scripts/generate-napp-helpers.mjs')], {
      cwd: tmpdir(), encoding: 'utf8', timeout: 30_000,
    });
    assert.ifError(result.error);
    assert.equal(result.status, 0, result.stderr);
    for (const [name, exported] of outputs) {
      const source = readFileSync(join(directory, `src/lib/napp/${name}.generated.ts`), 'utf8');
      assert.ok(source.includes(`export const ${exported} = `), name);
      assert.ok(source.length > 100, name);
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
