import { spawnSync } from 'node:child_process';
import { existsSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export function buildAndroidBundle(directory = resolve('android')) {
  const gradlePath = join(directory, 'app', 'build.gradle');
  if (!existsSync(gradlePath)) throw new Error('Run npm run android:prebuild first.');
  const output = join(directory, 'app', 'build', 'outputs', 'bundle', 'release', 'app-release.aab');
  rmSync(output, { force: true });
  try {
    const result = spawnSync('./gradlew', [':app:bundleRelease', '-PpsstpsstDebugSigning=false', '-PpsstpsstAbiSplits=false', '--no-daemon'], {
      cwd: directory, env: { ...process.env, EXPO_PUBLIC_APP_ENV: 'production' }, stdio: 'inherit',
    });
    if (result.error) throw result.error;
    if (result.status !== 0) throw new Error(`Android bundle build failed (exit ${result.status}).`);
  } catch (error) {
    rmSync(output, { force: true });
    throw error;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    buildAndroidBundle();
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
