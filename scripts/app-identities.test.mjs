import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { test } from 'node:test';

const require = createRequire(import.meta.url);
const configureExpo = require('../app.config.js');
const base = require('../app.json').expo;
const identities = require('../config/app-identities.json');

for (const variant of ['development', 'production', undefined, 'unknown']) {
  test(`mobile and desktop agree on identity for ${variant}`, () => {
    const previous = process.env.EXPO_PUBLIC_APP_ENV;
    try {
      if (variant === undefined) delete process.env.EXPO_PUBLIC_APP_ENV;
      else process.env.EXPO_PUBLIC_APP_ENV = variant;
      delete require.cache[require.resolve('../desktop/electron-builder.config.cjs')];
      const desktop = require('../desktop/electron-builder.config.cjs');
      const mobile = configureExpo({ config: base });
      const expected = variant === 'development' ? identities.development : identities.production;
      assert.equal(mobile.name, expected.name);
      assert.equal(mobile.ios.bundleIdentifier, expected.id);
      assert.equal(mobile.android.package, expected.id);
      assert.equal(mobile.scheme, expected.scheme);
      assert.equal(desktop.appId, expected.id);
      assert.equal(desktop.productName, expected.name);
      assert.equal(desktop.extraMetadata.name, expected.packageName);
      assert.deepEqual(desktop.protocols[0].schemes, [expected.scheme]);
      assert.equal(mobile.version, base.version);
      assert.equal(mobile.plugins, base.plugins);
      if (variant === 'development') {
        assert.equal(desktop.publish, null);
        assert.equal(desktop.win.publish, null);
        assert.equal(desktop.directories.output, '../release/development');
      } else {
        assert.equal(desktop.publish.repo, 'psstpsst');
        assert.equal(desktop.directories.output, '../release');
      }
      assert.equal(base.name, 'PsstPsst');
    } finally {
      if (previous === undefined) delete process.env.EXPO_PUBLIC_APP_ENV;
      else process.env.EXPO_PUBLIC_APP_ENV = previous;
    }
  });
}

test('installed variants do not share identifiers, names, or protocols', () => {
  for (const key of ['name', 'id', 'scheme', 'packageName']) {
    assert.notEqual(identities.production[key], identities.development[key]);
  }
});
