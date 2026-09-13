import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, symlinkSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const require = createRequire(import.meta.url);
const root = dirname(dirname(fileURLToPath(import.meta.url)));
const { IOSConfig } = require('@expo/config-plugins');
const xcode = require('xcode');
const app = require('../app.json').expo;
const identities = require('../config/app-identities.json');

test('clean prebuild assigns the configured team to the app and newly created share extension', () => {
  const directory = mkdtempSync(join(tmpdir(), 'psstpsst-signing-test-'));
  try {
    symlinkSync(join(root, 'node_modules'), join(directory, 'node_modules'), 'dir');
    // Preserve the real registration order: Xcode mods run in reverse order.
    const plugins = app.plugins.filter((plugin) =>
      plugin === './plugins/with-ios-signing' || (Array.isArray(plugin) && plugin[0] === 'expo-sharing'),
    ).map((plugin) => typeof plugin === 'string' ? join(root, plugin) : plugin);
    for (const identity of [identities.production, identities.development, identities.production]) {
      writeFileSync(join(directory, 'package.json'), JSON.stringify({
        name: 'signing-test', version: '1.0.0', dependencies: {
          expo: require('expo/package.json').version,
          'expo-sharing': require('expo-sharing/package.json').version,
        },
      }));
      writeFileSync(join(directory, 'app.json'), JSON.stringify({ expo: {
        name: 'PsstPsst', slug: 'psstpsst', scheme: identity.scheme, plugins,
        ios: { appleTeamId: app.ios.appleTeamId, bundleIdentifier: identity.id },
      } }));
      execFileSync(process.execPath, [
        join(root, 'node_modules/expo/bin/cli'), 'prebuild', '--platform', 'ios',
        '--clean', '--no-install', '--template', join(root, 'node_modules/expo/template.tgz'),
      ], { cwd: directory, env: { ...process.env, CI: '1' }, stdio: 'pipe', timeout: 60_000 });
      const project = xcode.project(join(directory, 'ios/PsstPsst.xcodeproj/project.pbxproj'));
      project.parseSync();
      const targets = IOSConfig.Target.getNativeTargets(project);
      assert.equal(targets.length, 2);
      for (const [, target] of targets) {
        const configurations = IOSConfig.XcodeUtils.getBuildConfigurationsForListId(project, target.buildConfigurationList);
        assert.deepEqual(configurations.map(([, config]) => config.name).sort(), ['Debug', 'Release']);
        for (const [, config] of configurations) {
          assert.equal(config.buildSettings.DEVELOPMENT_TEAM, app.ios.appleTeamId, `${target.name} ${config.name}`);
        }
      }
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
