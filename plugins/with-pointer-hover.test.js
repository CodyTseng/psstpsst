const { describe, expect, it } = require('@jest/globals');

const {
  applyAndroidPointerEvents,
  applyIosInfoPlist,
  applyIosPointerEvents,
} = require('./with-pointer-hover');

const APP_DELEGATE = `import React

class AppDelegate {
  func application() {
    let delegate = ReactNativeDelegate()
  }
}
`;

const MAIN_APPLICATION = `package com.example

import android.app.Application

class MainApplication : Application() {
  override fun onCreate() {
    super.onCreate()
    loadReactNative(this)
  }
}
`;

describe('with-pointer-hover', () => {
  it('enables indirect input events in the iOS manifest', () => {
    expect(applyIosInfoPlist({})).toMatchObject({
      UIApplicationSupportsIndirectInputEvents: true,
    });
  });

  it('enables iOS pointer dispatch before React Native starts', () => {
    const once = applyIosPointerEvents(APP_DELEGATE);
    const twice = applyIosPointerEvents(once);

    expect(twice).toBe(once);
    expect(once).toContain('RCTSetDispatchW3CPointerEvents(true)');
    expect(once.indexOf('RCTSetDispatchW3CPointerEvents(true)')).toBeLessThan(
      once.indexOf('let delegate = ReactNativeDelegate()'),
    );
  });

  it('enables Android pointer dispatch before React Native starts', () => {
    const once = applyAndroidPointerEvents(MAIN_APPLICATION);
    const twice = applyAndroidPointerEvents(once);

    expect(twice).toBe(once);
    expect(once).toContain('import com.facebook.react.config.ReactFeatureFlags');
    expect(once).toContain('ReactFeatureFlags.dispatchPointerEvents = true');
    expect(once.indexOf('ReactFeatureFlags.dispatchPointerEvents = true')).toBeLessThan(
      once.indexOf('loadReactNative(this)'),
    );
  });
});
