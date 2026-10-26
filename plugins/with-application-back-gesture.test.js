const { describe, expect, it } = require('@jest/globals');
const { applyAndroidBackGesture } = require('./with-application-back-gesture');

describe('with-application-back-gesture', () => {
  it.each(['null', 'savedInstanceState'])('attaches main-host cancellation after React Activity initialization (%s)', argument => {
    const source = `package com.example

class MainActivity : ReactActivity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(${argument})
  }
}
`;
    const result = applyAndroidBackGesture(source);
    expect(result).toContain('import chat.psstpsst.app.napplet.installApplicationBackGesture');
    expect(result.indexOf(`super.onCreate(${argument})`)).toBeLessThan(result.indexOf('installApplicationBackGesture(this)'));
    expect(applyAndroidBackGesture(result)).toBe(result);
  });

  it('fails explicitly if the native template no longer exposes the expected entry point', () => {
    expect(() => applyAndroidBackGesture('package com.example\nclass MainActivity : ReactActivity() {}\n')).toThrow('MainActivity.onCreate');
  });
});
