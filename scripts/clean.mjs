import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const projectRoot = fileURLToPath(new URL('../', import.meta.url));
const args = process.argv.slice(2);
if (args.some((arg) => arg !== '--dry-run')) {
  console.error('Usage: npm run clean -- [--dry-run]');
  process.exit(1);
}

// Limit Git's ignored-file cleanup to reproducible artifacts. Git protects
// tracked files, including any that now match an ignore rule.
const targets = [
  'node_modules',
  'desktop/node_modules',
  '.expo',
  'dist',
  'web-build',
  'expo-env.d.ts',
  'ios',
  'android',
  'desktop/dist',
  'desktop/native/proximity/bin',
  'desktop/native/proximity/linux/target',
  'desktop/native/proximity/windows/target',
  'release',
  '.kotlin',
  'coverage',
  '__pycache__',
  'scripts/__pycache__',
];

// Expand only known locations: wildcard pathspecs can cause git clean to remove
// an unrelated ignored parent directory that could contain a matching child.
for (const entry of readdirSync(new URL('../modules/', import.meta.url), { withFileTypes: true })) {
  if (!entry.isDirectory()) continue;
  for (const artifact of ['node_modules', 'android/build', 'android/.cxx', 'android/.gradle', 'android/.kotlin']) {
    targets.push(`modules/${entry.name}/${artifact}`);
  }
}
for (const entry of readdirSync(projectRoot, { withFileTypes: true })) {
  if (entry.isFile() && /(?:\.tsbuildinfo$|^\.metro-health-check|^(?:npm-debug|yarn-debug|yarn-error)\.)/.test(entry.name)) {
    targets.push(entry.name);
  }
}

const dryRun = args.includes('--dry-run');
const result = spawnSync('git', ['clean', dryRun ? '-ndX' : '-fdX', '--', ...targets.map((target) => `:(literal)${target}`)], {
  cwd: projectRoot,
  stdio: 'inherit',
});
if (result.error) throw result.error;
if (result.status !== 0) process.exit(result.status ?? 1);
console.log(dryRun ? 'Preview only; no files removed.' : 'Cleanup complete. Run npm ci to reinstall dependencies.');
