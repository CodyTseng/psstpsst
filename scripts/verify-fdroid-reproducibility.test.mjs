import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { test } from 'node:test';
import { verifyFdroidReproducibility } from './verify-fdroid-reproducibility.mjs';

test('verification copies the release signature and verifies the result', () => {
  const dir = mkdtempSync(join(tmpdir(), 'psstpsst-fdroid-test-'));
  try {
    const unsigned = join(dir, 'unsigned.apk');
    const signed = join(dir, 'signed.apk');
    writeFileSync(unsigned, 'unsigned');
    writeFileSync(signed, 'signed');
    const calls = [];
    let copied;
    verifyFdroidReproducibility(unsigned, signed, {
      PYTHON: '/tools/python3', APKSIGNER: '/sdk/apksigner',
    }, (command, args) => {
      calls.push([command, args]);
      if (command === '/tools/python3') {
        copied = args[3];
        writeFileSync(copied, 'signature copied');
      } else {
        assert.ok(existsSync(args.at(-1)));
      }
    });

    assert.equal(calls[0][0], '/tools/python3');
    assert.ok(calls[0][1][0].endsWith('/scripts/copy-apk-signature.py'));
    assert.deepEqual(calls[0][1].slice(1, 3), [resolve(signed), resolve(unsigned)]);
    assert.deepEqual(calls[1], ['/sdk/apksigner', ['verify', '--verbose', '--print-certs', copied]]);
    assert.ok(!existsSync(copied));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('verification cleans its temporary APK after a tool failure', () => {
  const dir = mkdtempSync(join(tmpdir(), 'psstpsst-fdroid-failure-test-'));
  try {
    const unsigned = join(dir, 'unsigned.apk');
    const signed = join(dir, 'signed.apk');
    writeFileSync(unsigned, 'unsigned');
    writeFileSync(signed, 'signed');
    let copied;
    assert.throws(() => verifyFdroidReproducibility(unsigned, signed, {
      PYTHON: 'python3', APKSIGNER: 'apksigner',
    }, (_command, args) => {
      copied = args.at(-1);
      throw new Error('fixture failure');
    }), /fixture failure/);
    assert.ok(!existsSync(copied));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('verification rejects missing or identical inputs', () => {
  assert.throws(() => verifyFdroidReproducibility(), /distinct unsigned and signed/);
  assert.throws(() => verifyFdroidReproducibility('same.apk', 'same.apk'), /distinct unsigned and signed/);
  assert.throws(() => verifyFdroidReproducibility('missing-unsigned.apk', 'missing-signed.apk'), /does not exist/);
});
