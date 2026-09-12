import {
  isInteractiveHovered,
  LIST_PRESS_DELAY_MS,
  resolveInteractiveState,
  resolvePressDelay,
  supportsHoverPointer,
} from '../InteractivePressable';

describe('InteractivePressable state', () => {
  it('mirrors runtime hover through the existing pressed feedback path', () => {
    expect(resolveInteractiveState({ pressed: false }, true)).toEqual({
      hovered: true,
      pressed: true,
    });
  });

  it('uses React Native Web hover state without waiting for component state', () => {
    expect(resolveInteractiveState({ pressed: false, hovered: true }, false)).toMatchObject({
      pressed: true,
      hovered: true,
    });
  });

  it('does not alter interaction state when no pointer is hovering', () => {
    expect(resolveInteractiveState({ pressed: false }, false)).toEqual({ pressed: false });
  });

  it('can suppress down-state feedback while preserving hover feedback', () => {
    expect(resolveInteractiveState({ pressed: true }, false, false)).toEqual({ pressed: false });
    expect(resolveInteractiveState({ pressed: false }, true, false)).toMatchObject({
      hovered: true,
      pressed: true,
    });
  });

  it('uses the shared list delay without overriding an explicit delay', () => {
    expect(resolvePressDelay('delayed', undefined)).toBe(LIST_PRESS_DELAY_MS);
    expect(resolvePressDelay('delayed', 120)).toBe(120);
    expect(resolvePressDelay('immediate', undefined)).toBeUndefined();
  });

  it('exposes hover to specialist render paths', () => {
    expect(isInteractiveHovered(resolveInteractiveState({ pressed: false }, true))).toBe(true);
    expect(isInteractiveHovered({ pressed: true })).toBe(false);
  });

  it('ignores contact-only touch pointers', () => {
    expect(supportsHoverPointer('touch')).toBe(false);
    expect(supportsHoverPointer(undefined)).toBe(false);
    expect(supportsHoverPointer('mouse')).toBe(true);
    expect(supportsHoverPointer('pen')).toBe(true);
  });
});
