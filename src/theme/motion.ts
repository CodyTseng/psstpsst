import { Easing, ReduceMotion } from 'react-native-reanimated';

/** Short, interruptible transitions for direct manipulation controls. */
export const manipulationTiming = {
  duration: 200,
  easing: Easing.out(Easing.cubic),
  reduceMotion: ReduceMotion.System,
} as const;

/** Media overlays finish fading before their content is released. */
export const mediaViewerTiming = {
  enter: manipulationTiming,
  exit: { ...manipulationTiming, duration: 160 },
} as const;
