import { createHash } from 'node:crypto';

export const sha256 = (value) => createHash('sha256').update(value).digest('hex');
export const compare = (a, b) => a < b ? -1 : a > b ? 1 : 0;
export const packageKey = (pkg) => `${pkg.name}@${pkg.version}`;

/** Only web URLs are exposed to the app. Package-manager Git shorthands are normalized. */
export function webUrl(value) {
  if (typeof value !== 'string') return undefined;
  let url = value.replace(/^git\+/, '').replace(/^git:\/\//, 'https://')
    .replace(/^git@github\.com:/, 'https://github.com/')
    .replace(/^ssh:\/\/git@github\.com\//, 'https://github.com/')
    .replace(/\.git(?=#|$)/, '');
  if (url.startsWith('github:')) url = `https://github.com/${url.slice(7)}`;
  try {
    const parsed = new URL(url);
    if (!['https:', 'http:'].includes(parsed.protocol) || parsed.username || parsed.password) return undefined;
    return parsed.href;
  } catch { return undefined; }
}

/** Recover the original bytes from the existing, hash-addressed notice snapshot. */
export function parseNoticeTexts(contents) {
  const texts = new Map();
  const sections = contents.split('\n========================================\n\nTEXT ');
  for (const section of sections.slice(1)) {
    const hash = section.slice(0, 64);
    const body = section.slice(66);
    // The collection adds separator newlines; only the matching original is accepted.
    const candidates = [body, body.slice(0, -1), body.slice(0, -2), body.slice(0, -3)];
    const original = candidates.find((text) => sha256(text) === hash);
    if (original === undefined) throw new Error(`Notice text checksum mismatch: ${hash}`);
    texts.set(hash, original);
  }
  if (!texts.size) throw new Error('No notice texts found');
  return texts;
}

/** Conservative cross-platform inventory, including transitive and optional packages.
 * Electron is a shipped runtime despite being declared as a development dependency. */
export function lockedPackages(lock) {
  const packages = new Map();
  for (const [location, pkg] of Object.entries(lock.packages)) {
    if (!location.includes('node_modules/') || pkg.link || (pkg.dev && location !== 'node_modules/electron')) continue;
    const name = pkg.name ?? location.split('node_modules/').at(-1);
    if (!pkg.version || !pkg.integrity) throw new Error(`Unpinned package: ${location}`);
    const entry = { ...pkg, name, location };
    const key = packageKey(entry);
    if (packages.has(key) && packages.get(key).integrity !== pkg.integrity) {
      throw new Error(`Conflicting package integrity: ${key}`);
    }
    packages.set(key, entry);
  }
  return [...packages.values()].sort((a, b) => compare(packageKey(a), packageKey(b)));
}

export function validateInventory(lock, inventory, texts) {
  const available = new Map(inventory.packages.map((pkg) => [packageKey(pkg), pkg]));
  const errors = [];
  const required = lockedPackages(lock);
  const requiredKeys = new Set(required.map(packageKey));
  for (const key of available.keys()) {
    if (!requiredKeys.has(key)) errors.push(`Retired package still in inventory: ${key}`);
  }
  for (const pkg of required) {
    const found = available.get(packageKey(pkg));
    if (!found || found.integrity !== pkg.integrity) {
      errors.push(`Missing or changed package: ${packageKey(pkg)}`);
      continue;
    }
    if (!found.license || !found.licenseFiles?.length) errors.push(`Missing license: ${packageKey(pkg)}`);
    for (const file of found.licenseFiles ?? []) {
      if (!texts.get(file.sha256)?.trim()) errors.push(`Missing text: ${packageKey(pkg)} / ${file.source}`);
    }
  }
  if (errors.length) throw new Error(`${errors.join('\n')}\nRun npm run licenses:refresh and review the changes.`);
}

export function serializeNotices(packages, texts) {
  const separator = '\n========================================\n\n';
  const descriptions = packages.map((pkg) => [
    packageKey(pkg), `License: ${pkg.license}`, `Source: ${pkg.repository ?? pkg.homepage ?? ''}`,
    ...pkg.licenseFiles.map((file) => `${file.source}\n  Text: ${file.sha256}`),
  ].join('\n'));
  const used = [...new Set(packages.flatMap((pkg) => pkg.licenseFiles.map((file) => file.sha256)))];
  return 'PsstPsst dependency license notices\n\n' +
    'Cross-platform non-development npm dependency closure, plus the shipped Electron runtime.\n' +
    'Includes optional packages and build utilities; not an exact binary inventory.\n' +
    separator + descriptions.join(separator) + separator +
    used.map((hash) => `TEXT ${hash}\n\n${texts.get(hash)}`).join(separator) + '\n';
}
