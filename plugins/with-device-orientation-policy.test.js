const { describe, expect, it } = require('@jest/globals');

const {
  applyAndroidOrientationPolicy,
  applyIosOrientationPolicy,
} = require('./with-device-orientation-policy');

const MAIN_ACTIVITY = `package com.example

import android.os.Bundle
import com.facebook.react.ReactActivity

class MainActivity : ReactActivity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(null)
  }
}
`;

describe('with-device-orientation-policy', () => {
  it('limits iPhone to portrait while leaving every iPad orientation available', () => {
    const infoPlist = applyIosOrientationPolicy({});

    expect(infoPlist.UISupportedInterfaceOrientations).toEqual([
      'UIInterfaceOrientationPortrait',
    ]);
    expect(infoPlist['UISupportedInterfaceOrientations~ipad']).toEqual([
      'UIInterfaceOrientationPortrait',
      'UIInterfaceOrientationPortraitUpsideDown',
      'UIInterfaceOrientationLandscapeLeft',
      'UIInterfaceOrientationLandscapeRight',
    ]);
  });

  it('adds an idempotent Android display-size policy', () => {
    const once = applyAndroidOrientationPolicy(MAIN_ACTIVITY);
    const twice = applyAndroidOrientationPolicy(once);

    expect(twice).toBe(once);
    expect(once).toContain('windowManager.maximumWindowMetrics.bounds');
    expect(once).toContain('LARGE_DISPLAY_SMALLEST_WIDTH_DP = 600f');
    expect(once).toContain('ActivityInfo.SCREEN_ORIENTATION_PORTRAIT');
    expect(once).toContain('ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED');
    expect(once).toContain('override fun onConfigurationChanged');
    expect(once.match(/applyDisplayOrientationPolicy\(\)/g)).toHaveLength(3);
  });
});
