import type { NativeStackNavigationOptions } from 'expo-router';

/**
 * Keep iOS back navigation on the native logical-start edge. Restricting the
 * recognizer to the edge lets horizontal content gestures, such as message
 * swipe-to-reply and media paging, continue to own drags elsewhere.
 */
export const NATIVE_SWIPE_BACK_SCREEN_OPTIONS = {
  gestureEnabled: true,
  gestureDirection: 'horizontal',
  fullScreenGestureEnabled: false,
} satisfies NativeStackNavigationOptions;
