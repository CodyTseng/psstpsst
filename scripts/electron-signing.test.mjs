import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { test } from 'node:test';

const require = createRequire(import.meta.url);
// Initialize the public entry point before loading packagers with circular imports.
require('app-builder-lib');
const { MacPackager } = require('app-builder-lib/out/macPackager');
const signing = require('app-builder-lib/out/codeSign/macCodeSign');

test('macOS signing preserves distinct fingerprints for certificates with the same name', async () => {
  const originalSign = signing.sign;
  const calls = [];
  signing.sign = async (options) => calls.push(options);
  const packager = {
    appInfo: { type: 'commonjs' },
    info: { getWorkspaceRoot: async () => process.cwd() },
  };
  const options = {
    app: '/tmp/PsstPsst.app',
    platform: 'darwin',
    type: 'distribution',
    keychain: '/tmp/signing.keychain',
    identityValidation: false,
  };
  try {
    for (const hash of ['A'.repeat(40), 'B'.repeat(40)]) {
      await MacPackager.prototype.doSign.call(packager, options, {}, {
        name: 'Developer ID Application: Example (TEAMID)',
        hash,
      });
      assert.deepEqual(calls.at(-1), { ...options, identity: hash });
    }
    await MacPackager.prototype.doSign.call(packager, options, {}, { name: '-' });
    assert.equal(calls.at(-1).identity, '-');
  } finally {
    signing.sign = originalSign;
  }
});
