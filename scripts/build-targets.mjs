import { appendFileSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const desktopTargets = [
  { platform: 'macos', arch: 'arm64', name: 'macOS arm64', artifact: 'electron-macos-arm64', runner: 'macos-15', 'builder-args': '--mac --arm64' },
  { platform: 'windows', arch: 'x64', name: 'Windows x64', artifact: 'electron-windows-x64', runner: 'windows-2025', 'builder-args': '--win --x64' },
  { platform: 'windows', arch: 'arm64', name: 'Windows arm64', artifact: 'electron-windows-arm64', runner: 'windows-11-arm', 'builder-args': '--win --arm64' },
  { platform: 'linux', arch: 'x64', name: 'Linux x64', artifact: 'electron-linux-x64', runner: 'ubuntu-24.04', 'builder-args': '--linux --x64' },
  { platform: 'linux', arch: 'arm64', name: 'Linux arm64', artifact: 'electron-linux-arm64', runner: 'ubuntu-24.04-arm', 'builder-args': '--linux --arm64' },
];

export function planBuild(eventName, inputs = {}, hasAndroidSigning = false) {
  const manual = eventName === 'workflow_dispatch';
  const selections = manual ? {
    macos: inputs.macos ?? 'arm64', windows: inputs.windows ?? 'all',
    linux: inputs.linux ?? 'all', android: inputs.android ?? 'all',
  } : { macos: 'arm64', windows: 'all', linux: 'all', android: 'all' };
  for (const [platform, options] of Object.entries({
    macos: ['none', 'arm64'], windows: ['none', 'x64', 'arm64', 'all'],
    linux: ['none', 'x64', 'arm64', 'all'], android: ['none', 'apk', 'aab', 'all'],
  })) {
    if (!options.includes(selections[platform])) throw new Error(`Invalid ${platform} build selection.`);
  }
  const include = desktopTargets.filter(({ platform, arch }) =>
    selections[platform] === 'all' || selections[platform] === arch);
  const apk = ['apk', 'all'].includes(selections.android);
  const aab = selections.android === 'aab'
    || (selections.android === 'all' && (!manual || hasAndroidSigning));
  if (manual && aab && !hasAndroidSigning) {
    throw new Error('Selected AAB builds require Android signing credentials. See docs/RELEASING.md.');
  }
  if (include.length === 0 && !apk && !aab) throw new Error('Select at least one build target.');
  return {
    matrix: { include }, desktop: include.length > 0,
    macos: include.some(({ platform }) => platform === 'macos'), android: apk || aab, apk, aab,
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const event = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8'));
    const plan = planBuild(process.env.GITHUB_EVENT_NAME, event.inputs, process.env.HAS_ANDROID_SIGNING === 'true');
    const outputs = Object.entries(plan).map(([key, value]) =>
      `${key}=${typeof value === 'object' ? JSON.stringify(value) : value}\n`).join('');
    appendFileSync(process.env.GITHUB_OUTPUT, outputs);
    console.log(`Selected builds: ${[
      ...plan.matrix.include.map(({ name }) => name),
      ...(plan.apk ? ['Android APK'] : []), ...(plan.aab ? ['Android AAB'] : []),
    ].join(', ')}`);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
