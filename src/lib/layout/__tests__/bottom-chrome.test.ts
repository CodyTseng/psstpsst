import { getBottomChromeInset } from '../bottom-chrome';

describe('bottom chrome inset', () => {
  it('does not add a bottom spacer on Electron', () => {
    expect(getBottomChromeInset(0, true)).toBe(0);
    expect(getBottomChromeInset(12, true)).toBe(0);
  });

  it('preserves the mobile fallback and larger safe areas', () => {
    expect(getBottomChromeInset(0, false)).toBe(12);
    expect(getBottomChromeInset(8, false)).toBe(12);
    expect(getBottomChromeInset(34, false)).toBe(34);
  });
});
