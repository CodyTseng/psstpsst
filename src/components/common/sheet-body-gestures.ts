import { createContext, useContext } from 'react';
import type { Gesture } from 'react-native-gesture-handler';

type SheetBodyGestures = readonly [ReturnType<typeof Gesture.Pan>, ReturnType<typeof Gesture.Native>];

/** Interactive body controls can take precedence over scrolling and dismissal. */
export const SheetBodyGestureContext = createContext<SheetBodyGestures | null>(null);

export function useSheetBodyGestures() {
  return useContext(SheetBodyGestureContext);
}
