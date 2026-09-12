import { isWindowUserPresent } from '../window-presence';

function windowState(visible: boolean, focused: boolean) {
  return {
    isVisible: () => visible,
    isFocused: () => focused,
  };
}

describe('desktop window presence', () => {
  it('reports the user present only for a visible focused window', () => {
    expect(isWindowUserPresent(windowState(true, true))).toBe(true);
    expect(isWindowUserPresent(windowState(true, false))).toBe(false);
    expect(isWindowUserPresent(windowState(false, true))).toBe(false);
    expect(isWindowUserPresent(windowState(false, false))).toBe(false);
  });
});
