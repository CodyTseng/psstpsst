import { Buffer } from 'node:buffer';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { createElectronStderrFilter } from './electron-output.mjs';

const diagnostic = '2026-10-28 14:14:25.331 Electron[34454:31085618] TSM AdjustCapsLockLEDForKeyTransitionHandling - _ISSetPhysicalKeyboardCapsLockLED Inhibit';
async function filtered(chunks, platform = 'darwin') {
  let output = '';
  for await (const chunk of Readable.from(chunks).pipe(createElectronStderrFilter(platform))) output += chunk;
  return output;
}

test('filters only the exact macOS diagnostic across stderr chunks', async () => {
  assert.equal(await filtered(['Native error\n' + diagnostic.slice(0, 70), diagnostic.slice(70) + '\nRenderer failed\n']), 'Native error\nRenderer failed\n');
  assert.equal(await filtered([diagnostic]), '');
  assert.equal(await filtered([diagnostic + '\n'], 'linux'), diagnostic + '\n');
  const other = diagnostic.replace('Inhibit', 'Unexpected failure');
  assert.equal(await filtered([other + '\n']), other + '\n');
});

test('preserves Unicode boundaries, partial errors and large unterminated output', async () => {
  const bytes = Buffer.from('错误\n');
  assert.equal(await filtered([bytes.subarray(0, 2), bytes.subarray(2)]), '错误\n');
  assert.equal(await filtered(['Unhandled exception']), 'Unhandled exception');
  const large = 'x'.repeat(100_000);
  assert.equal(await filtered([large]), large);
});
