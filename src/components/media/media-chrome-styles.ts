import { StyleSheet } from 'react-native';

// React Native Web compiles box-none into parent/child CSS rules only for
// registered styles; an inline box-none value is invalid browser CSS.
// Animated surfaces apply these through MediaChromeView after style copying.
export const mediaChromePointerStyles = StyleSheet.create({
  passthrough: { pointerEvents: 'box-none' },
  hidden: { pointerEvents: 'none' },
});
