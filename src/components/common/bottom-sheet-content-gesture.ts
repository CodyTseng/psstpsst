import { Gesture } from 'react-native-gesture-handler';
import type { SharedValue } from 'react-native-reanimated';

export type SheetContentPanState = {
  phase: 'pending' | 'scrolling' | 'dragging';
  x: number;
  y: number;
};

/** A scroll cannot become a sheet drag midway through the same touch sequence. */
export function createSheetContentPan({ native, scrollY, translateY, state, settle, dismiss,
  dismissDistance, dismissVelocity }: {
  native: ReturnType<typeof Gesture.Native>;
  scrollY: SharedValue<number>;
  translateY: SharedValue<number>;
  state: SharedValue<SheetContentPanState>;
  settle: () => void;
  dismiss: () => void;
  dismissDistance: number;
  dismissVelocity: number;
}) {
  return Gesture.Pan()
    .manualActivation(true)
    .simultaneousWithExternalGesture(native)
    .onTouchesDown((event, manager) => {
      'worklet';
      const touch = event.allTouches[0];
      const eligible = event.allTouches.length === 1 && scrollY.value <= 0;
      state.value = { phase: eligible ? 'pending' : 'scrolling', x: touch?.absoluteX ?? 0, y: touch?.absoluteY ?? 0 };
      if (!eligible) manager.fail();
    })
    .onTouchesMove((event, manager) => {
      'worklet';
      if (state.value.phase !== 'pending') return;
      const touch = event.allTouches[0];
      if (!touch || event.allTouches.length !== 1) {
        state.value = { ...state.value, phase: 'scrolling' };
        manager.fail();
        return;
      }
      const dx = touch.absoluteX - state.value.x;
      const dy = touch.absoluteY - state.value.y;
      if ((Math.abs(dx) > 10 && Math.abs(dx) > Math.abs(dy)) || dy < -10) {
        state.value = { ...state.value, phase: 'scrolling' };
        manager.fail();
      } else if (dy > 10) {
        state.value = { ...state.value, phase: 'dragging' };
        manager.activate();
      }
    })
    .onUpdate((event) => {
      'worklet';
      if (state.value.phase === 'dragging') translateY.value = Math.max(0, event.translationY);
    })
    .onEnd((event) => {
      'worklet';
      if (event.translationY > dismissDistance || event.velocityY > dismissVelocity) dismiss();
      else settle();
    })
    .onFinalize((_event, success) => {
      'worklet';
      if (!success && state.value.phase === 'dragging') settle();
    });
}
