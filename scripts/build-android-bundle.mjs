import { spawnSync } from 'node:child_process';
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export function buildAndroidBundle(directory = resolve('android')) {
  const gradlePath = join(directory, 'app', 'build.gradle');
  const original = readFileSync(gradlePath, 'utf8');
  // Disable only the release template signature; APK and debug builds keep their defaults.
  const unsigned = original.replace(
    /(\brelease\s*\{[\s\S]*?\n[ \t]*)signingConfig signingConfigs\.debug\b/,
    '$1signingConfig null',
  );
  if (unsigned === original) {
    throw new Error('Expected the Expo release debug signing configuration. Run npm run android:prebuild first.');
  }
  const output = join(directory, 'app', 'build', 'outputs', 'bundle', 'release', 'app-release.aab');
  rmSync(output, { force: true });
  try {
    writeFileSync(gradlePath, unsigned);
    const result = spawnSync('./gradlew', [':app:bundleRelease', '--no-daemon', '--max-workers=2'], {
      cwd: directory, env: { ...process.env, EXPO_PUBLIC_APP_ENV: 'production' }, stdio: 'inherit',
    });
    if (result.error) throw result.error;
    if (result.status !== 0) throw new Error(`Android bundle build failed (exit ${result.status}).`);
  } catch (error) {
    rmSync(output, { force: true });
    throw error;
  } finally {
    writeFileSync(gradlePath, original);
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
