import { Easing, ReduceMotion } from 'react-native-reanimated';

/** Brief arrival feedback without bounce or a layout change. */
export const noticeTiming = {
  duration: 180,
  bezier: [0.23, 1, 0.32, 1],
  reduceMotion: ReduceMotion.System,
} as const;

/** Upward notice dismissal requires deliberate travel before release. */
export const noticeDismissal = {
  activationDistance: 8,
  horizontalTolerance: 16,
  threshold: 32,
  settle: {
    duration: 400,
    dampingRatio: 1,
    overshootClamping: true,
    reduceMotion: ReduceMotion.System,
  },
  exit: {
    duration: 300,
    dampingRatio: 1,
    overshootClamping: true,
    reduceMotion: ReduceMotion.System,
  },
} as const;

/** Short, interruptible transitions for direct manipulation controls. */
export const manipulationTiming = {
  duration: 200,
  // The x coordinates make x(t) = t; y(t) is exactly cubic ease-out.
  // Unlike Easing.out(), this also serializes for web layout animations.
  easing: Easing.bezier(1 / 3, 1, 2 / 3, 1),
  reduceMotion: ReduceMotion.System,
} as const;

/** Media overlays finish fading before their content is released. */
export const mediaViewerTiming = {
  enter: manipulationTiming,
  exit: { ...manipulationTiming, duration: 160 },
} as const;
