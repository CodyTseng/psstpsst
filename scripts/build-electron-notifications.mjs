import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

if (process.platform === 'darwin') {
  const require = createRequire(import.meta.url);
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const output = path.join(root, 'desktop/dist/native');
  const headers = require('node-api-headers').include_dir;
  mkdirSync(output, { recursive: true });
  const result = spawnSync('xcrun', [
    'clang', '-bundle', '-undefined', 'dynamic_lookup', '-fobjc-arc', '-O2',
    '-arch', 'arm64', '-arch', 'x86_64', '-mmacosx-version-min=12.0',
    '-DNAPI_VERSION=8', '-I', headers,
    '-framework', 'Foundation', '-framework', 'UserNotifications',
    path.join(root, 'desktop/native/notifications/permissions.m'),
    '-o', path.join(output, 'notification-permissions.node'),
  ], { stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
  copyFileSync(path.join(headers, '../LICENSE'), path.join(output, 'NODE_API_HEADERS_LICENSE'));
}
