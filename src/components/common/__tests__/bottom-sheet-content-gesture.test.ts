import type { SharedValue } from 'react-native-reanimated';
import { Gesture } from 'react-native-gesture-handler';
import { createSheetContentPan, type SheetContentPanState } from '../bottom-sheet-content-gesture';

let mockCallbacks: Record<string, (...args: any[]) => void>;
jest.mock('react-native-gesture-handler', () => ({ Gesture: { Pan: () => {
  mockCallbacks = {};
  const builder: Record<string, (...args: any[]) => unknown> = {};
  for (const method of ['manualActivation', 'simultaneousWithExternalGesture', 'onTouchesDown', 'onTouchesMove', 'onUpdate', 'onEnd', 'onFinalize']) {
    builder[method] = (value: any) => { mockCallbacks[method] = value; return builder; };
  }
  return builder;
} } }));
const shared = <T,>(value: T) => ({ value } as SharedValue<T>);
function setup(offset: number) {
  const scrollY = shared(offset), translateY = shared(0);
  const state = shared<SheetContentPanState>({ phase: 'pending', x: 0, y: 0 });
  const settle = jest.fn(), dismiss = jest.fn();
  createSheetContentPan({ native: {} as ReturnType<typeof Gesture.Native>, scrollY, translateY, state,
    settle, dismiss, dismissDistance: 120, dismissVelocity: 800 });
  const manager = { fail: jest.fn(), activate: jest.fn() };
  const touch = (y: number) => ({ allTouches: [{ absoluteX: 100, absoluteY: y }] });
  return { scrollY, translateY, manager, settle, dismiss,
    down: () => mockCallbacks.onTouchesDown(touch(100), manager),
    move: (y: number) => mockCallbacks.onTouchesMove(touch(y), manager),
  };
}

it('never takes over a scroll that reaches the top midway through a gesture', () => {
  const test = setup(80);
  test.down();
  test.scrollY.value = 0;
  test.move(250);
  mockCallbacks.onUpdate({ translationY: 150 });
  expect(test.manager.fail).toHaveBeenCalledTimes(1);
  expect(test.manager.activate).not.toHaveBeenCalled();
  expect(test.translateY.value).toBe(0);
});

it('allows a fresh downward drag at the top to follow the finger and dismiss', () => {
  const test = setup(0);
  test.down(); test.move(120);
  mockCallbacks.onUpdate({ translationY: 20 });
  expect(test.manager.activate).toHaveBeenCalledTimes(1);
  expect(test.translateY.value).toBe(20);
  mockCallbacks.onEnd({ translationY: 130, velocityY: 100 });
  mockCallbacks.onFinalize({}, true);
  expect(test.dismiss).toHaveBeenCalledTimes(1);
  expect(test.settle).not.toHaveBeenCalled();
});

it('keeps an upward scroll at the top from becoming a dismiss gesture after reversal', () => {
  const test = setup(0);
  test.down(); test.move(80); test.move(140);
  mockCallbacks.onUpdate({ translationY: 40 });
  expect(test.manager.fail).toHaveBeenCalledTimes(1);
  expect(test.manager.activate).not.toHaveBeenCalled();
  expect(test.translateY.value).toBe(0);
});

it('settles a cancelled active drag without dismissing', () => {
  const test = setup(0);
  test.down(); test.move(120);
  mockCallbacks.onUpdate({ translationY: 20 });
  mockCallbacks.onFinalize({}, false);
  expect(test.settle).toHaveBeenCalledTimes(1);
  expect(test.dismiss).not.toHaveBeenCalled();
});
