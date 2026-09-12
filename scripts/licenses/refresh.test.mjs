import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { sha256 } from './catalog.mjs';
import { refreshInventory, reviewedLibvipsNotice } from './refresh.mjs';

test('libvips notices require the reviewed version and exact nonempty snapshot', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'libvips-notices-'));
  const file = 'desktop/sharp-libvips-posix.txt';
  const destination = path.join(root, 'licenses/third-party', file);
  const text = 'Original copyright and license text.\n';
  const snapshots = { versions: { 'sharp-libvips-posix': '1.3.3' }, files: [{ path: file, sha256: sha256(text) }] };
  const pkg = { name: '@img/sharp-libvips-linux-x64', version: '1.3.3', license: 'LGPL-3.0-or-later', integrity: 'sha512-example' };
  try {
    await fs.mkdir(path.dirname(destination), { recursive: true });
    await fs.writeFile(destination, text);
    const texts = new Map();
    const result = await reviewedLibvipsNotice(root, pkg, snapshots, texts);
    assert.equal(result.version, pkg.version);
    assert.equal(result.integrity, pkg.integrity);
    assert.equal(texts.get(result.licenseFiles[0].sha256), text);
    await fs.writeFile(path.join(root, 'licenses/third-party/snapshots.json'), JSON.stringify(snapshots));
    const unreviewed = { ...result, version: '1.3.4' };
    await assert.rejects(refreshInventory(root, { packages: { [`node_modules/${pkg.name}`]: unreviewed } },
      { packages: [unreviewed] }, texts), /Review sharp-libvips 1.3.4/);
    await assert.rejects(reviewedLibvipsNotice(root, { ...pkg, version: '1.3.4' }, snapshots, texts), /Review sharp-libvips 1.3.4/);
    await assert.rejects(reviewedLibvipsNotice(root, pkg, { ...snapshots, files: [] }, texts), /Reviewed snapshot changed/);
    const overridden = { ...pkg, name: '@expo/xcpretty', version: '4.4.5', license: 'BSD-3-Clause' };
    const overrideSnapshots = { ...snapshots, npmOverrides: {
      [overridden.name]: { version: overridden.version, integrity: overridden.integrity, file },
    } };
    const overrideLock = { packages: { [`node_modules/${overridden.name}`]: overridden } };
    await fs.writeFile(path.join(root, 'licenses/third-party/snapshots.json'), JSON.stringify(overrideSnapshots));
    await fs.mkdir(path.join(root, 'licenses/third-party/common'), { recursive: true });
    await fs.writeFile(path.join(root, 'package-lock.json'), JSON.stringify(overrideLock));
    const inventory = await refreshInventory(root, overrideLock, { packages: [] }, texts);
    assert.equal(inventory.packages[0].licenseFiles[0].sha256, sha256(text));
    const changedLock = { packages: { [`node_modules/${overridden.name}`]: { ...overridden, integrity: 'changed' } } };
    await assert.rejects(refreshInventory(root, changedLock, inventory, texts), /update its npm override/);
    await fs.writeFile(destination, 'Changed without review');
    await assert.rejects(reviewedLibvipsNotice(root, pkg, snapshots, texts), /Reviewed snapshot changed/);
    await fs.writeFile(destination, '');
    await assert.rejects(reviewedLibvipsNotice(root, pkg, { ...snapshots, files: [{ path: file, sha256: sha256('') }] }, texts), /Reviewed snapshot changed/);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
