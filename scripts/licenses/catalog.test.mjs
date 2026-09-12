import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  lockedPackages, parseNoticeTexts, serializeNotices, sha256, validateInventory, webUrl,
} from './catalog.mjs';

const text = 'Copyright © Example\r\nPermission is granted.\r\n';
const hash = sha256(text);
const pkg = { name: 'example', version: '1.2.3', integrity: 'sha512-example', license: 'MIT',
  licenseFiles: [{ source: 'LICENSE', sha256: hash }] };
const lock = { packages: { '': {}, 'node_modules/example': pkg } };

test('round-trips verbatim notices, including CRLF, Unicode, and trailing newlines', () => {
  for (const original of [text, text.trimEnd(), text + '\n\n']) {
    const id = sha256(original);
    const packages = [{ ...pkg, licenseFiles: [{ source: 'COPYING', sha256: id }] }];
    const serialized = serializeNotices(packages, new Map([[id, original]]));
    assert.equal(parseNoticeTexts(serialized).get(id), original);
    assert.throws(() => parseNoticeTexts(serialized.replace('Permission', 'Changed')), /checksum mismatch/);
  }
});

test('includes optional and nested packages on every platform and the Electron runtime', () => {
  const packages = lockedPackages({ packages: {
    '': {},
    'node_modules/example': { ...pkg },
    'node_modules/a/node_modules/example': { ...pkg, version: '2.0.0' },
    'node_modules/windows-only': { ...pkg, name: 'windows-only', optional: true, os: ['win32'] },
    'node_modules/electron': { ...pkg, name: 'electron', dev: true },
    'node_modules/jest': { ...pkg, name: 'jest', dev: true },
    'node_modules/local-workspace': { link: true },
  } });
  assert.deepEqual(packages.map((entry) => `${entry.name}@${entry.version}`), [
    'electron@1.2.3', 'example@1.2.3', 'example@2.0.0', 'windows-only@1.2.3',
  ]);
});

test('rejects omitted packages, stale integrity, and missing or empty notices', () => {
  const texts = new Map([[hash, text]]);
  assert.doesNotThrow(() => validateInventory(lock, { packages: [pkg] }, texts));
  assert.throws(() => validateInventory(lock, { packages: [] }, texts), /Missing or changed/);
  assert.throws(() => validateInventory(lock, { packages: [{ ...pkg, integrity: 'changed' }] }, texts), /Missing or changed/);
  assert.throws(() => validateInventory(lock, { packages: [pkg] }, new Map()), /Missing text/);
  assert.throws(() => validateInventory(lock, { packages: [{ ...pkg, licenseFiles: [] }] }, texts), /Missing license/);
  assert.throws(() => validateInventory(lock, { packages: [pkg, { ...pkg, version: '0.1.0' }] }, texts), /Retired package/);
  assert.throws(() => validateInventory(lock, { packages: [pkg] }, new Map([[hash, '  ']])), /Missing text/);
});

test('normalizes package repository forms without exposing privileged URL schemes', () => {
  for (const url of ['git+https://github.com/org/repo.git', 'git://github.com/org/repo.git',
    'git@github.com:org/repo.git', 'ssh://git@github.com/org/repo.git', 'github:org/repo']) {
    assert.equal(webUrl(url), 'https://github.com/org/repo');
  }
  for (const url of ['javascript:alert(1)', 'file:///etc/passwd', 'https://user:secret@example.com', undefined]) {
    assert.equal(webUrl(url), undefined);
  }
});
