import { execFileSync } from 'node:child_process';
import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { compare, lockedPackages, packageKey, serializeNotices, sha256 } from './catalog.mjs';

/** Fetch only immutable, integrity-checked npm archives. No package scripts are run.
 * tar reads individual files to stdout; archive paths are never extracted to disk. */
async function collectArchive(pkg, directory) {
  if (!pkg.resolved?.startsWith('https://registry.npmjs.org/')) {
    throw new Error(`Review non-registry source manually: ${packageKey(pkg)}`);
  }
  const response = await fetch(pkg.resolved, { signal: AbortSignal.timeout(120_000) });
  if (!response.ok) throw new Error(`Download failed: ${packageKey(pkg)} (${response.status})`);
  const bytes = Buffer.from(await response.arrayBuffer());
  const [algorithm, expected] = pkg.integrity.split('-');
  if (!['sha512', 'sha256', 'sha1'].includes(algorithm) || createHash(algorithm).update(bytes).digest('base64') !== expected) {
    throw new Error(`Archive integrity mismatch: ${packageKey(pkg)}`);
  }
  const archive = path.join(directory, `${sha256(packageKey(pkg))}.tgz`);
  await fs.writeFile(archive, bytes);
  try {
    const files = execFileSync('tar', ['-tzf', archive], { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 }).split('\n');
    const read = (name) => execFileSync('tar', ['-xOzf', archive, '--', name], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
    const metadata = JSON.parse(read('package/package.json'));
    if (metadata.name !== pkg.name || metadata.version !== pkg.version) throw new Error(`Archive identity mismatch: ${packageKey(pkg)}`);
    const notices = files.filter((file) => !file.endsWith('/') &&
      /^(?:licen[cs]e|copying|notice|copyright|authors|patents)(?:[._-]|$)/i.test(path.posix.basename(file)));
    if (!notices.length) throw new Error(`No notice files in ${packageKey(pkg)}; add a reviewed override.`);
    return {
      metadata,
      files: notices.sort(compare).map((file) => ({ source: file.replace(/^package\//, ''), text: read(file) })),
    };
  } finally { await fs.rm(archive, { force: true }); }
}

export async function refreshInventory(root, lock, oldInventory, texts) {
  const snapshots = JSON.parse(await fs.readFile(path.join(root, 'licenses/third-party/snapshots.json'), 'utf8'));
  const prior = new Map(oldInventory.packages.map((pkg) => [packageKey(pkg), pkg]));
  const packages = [];
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'psstpsst-licenses-'));
  try {
    // Bounded concurrency keeps native archive memory use under control.
    const pending = lockedPackages(lock);
    async function worker() {
      while (pending.length) {
        const pkg = pending.shift();
        if (pkg.name.startsWith('@img/sharp-libvips-')) {
          packages.push(await reviewedLibvipsNotice(root, pkg, snapshots, texts));
          continue;
        }
        const override = snapshots.npmOverrides?.[pkg.name];
        if (override) {
          if (pkg.version !== override.version || pkg.integrity !== override.integrity) {
            throw new Error(`Review ${packageKey(pkg)} notices and update its npm override in snapshots.json.`);
          }
          packages.push(await reviewedSnapshotNotice(root, pkg, snapshots, texts, override.file));
          continue;
        }
        const previous = prior.get(packageKey(pkg));
        if (previous?.integrity === pkg.integrity && previous.licenseFiles.every((file) => texts.has(file.sha256))) {
          packages.push(previous);
          continue;
        }
        console.log(`Collecting ${packageKey(pkg)}`);
        const { metadata, files } = await collectArchive(pkg, directory);
        const license = typeof metadata.license === 'string' ? metadata.license : metadata.license?.type;
        if (!license) throw new Error(`Missing declared license: ${packageKey(pkg)}`);
        packages.push({
          name: pkg.name, version: pkg.version, license, integrity: pkg.integrity,
          repository: typeof metadata.repository === 'string' ? metadata.repository : metadata.repository?.url,
          homepage: metadata.homepage,
          licenseFiles: files.map(({ source, text }) => {
            const hash = sha256(text);
            texts.set(hash, text);
            return { source, sha256: hash };
          }),
        });
      }
    }
    const results = await Promise.allSettled([worker(), worker(), worker()]);
    const failed = results.find((result) => result.status === 'rejected');
    if (failed) throw failed.reason;
  } finally { await fs.rm(directory, { recursive: true, force: true }); }
  packages.sort((a, b) => compare(packageKey(a), packageKey(b)));
  const inventory = {
    reviewed: new Date().toISOString().slice(0, 10),
    lockfileSha256: sha256(await fs.readFile(path.join(root, 'package-lock.json'))),
    scope: 'All locked non-development npm packages on all platforms, plus the shipped Electron runtime. Includes build utilities; not an exact binary inventory.',
    packages,
  };
  await fs.writeFile(path.join(root, 'licenses/third-party/common/npm-inventory.json'), JSON.stringify(inventory, null, 2) + '\n');
  await fs.writeFile(path.join(root, 'licenses/third-party/common/npm-notices.txt'), serializeNotices(packages, texts));
  return inventory;
}

// These archives omit original notices. Use the reviewed snapshot's version and
// hash as the single source of truth, including when an inventory entry is cached.
export async function reviewedLibvipsNotice(root, pkg, snapshots, texts) {
  const version = snapshots.versions['sharp-libvips-posix'];
  if (pkg.version !== version) {
    throw new Error(`Review sharp-libvips ${pkg.version} notices and update snapshots.json (currently ${version}).`);
  }
  return reviewedSnapshotNotice(root, pkg, snapshots, texts, 'desktop/sharp-libvips-posix.txt', 'https://github.com/lovell/sharp-libvips');
}

async function reviewedSnapshotNotice(root, pkg, snapshots, texts, file, repository) {
  const source = `licenses/third-party/${file}`;
  const text = await fs.readFile(path.join(root, source), 'utf8');
  const hash = sha256(text);
  if (!text.trim() || snapshots.files.find((entry) => entry.path === file)?.sha256 !== hash) {
    throw new Error(`Reviewed snapshot changed: ${file}. Review and update snapshots.json.`);
  }
  texts.set(hash, text);
  return { name: pkg.name, version: pkg.version, license: pkg.license,
    integrity: pkg.integrity, ...(repository ? { repository } : {}),
    licenseFiles: [{ source: `Reviewed distribution notices: ${source}`, sha256: hash }] };
}
