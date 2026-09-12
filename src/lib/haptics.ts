import * as Haptics from 'expo-haptics';

/** Run a haptic, tolerating a dev client that wasn't rebuilt after `expo-haptics`
 * was added (the native module is then missing, and the call throws synchronously
 * or rejects). Haptics are a nicety — never crash for them. */
function safe(run: () => Promise<void>) {
  try {
    void run().catch(() => {});
  } catch {
    // Native module not linked in this build — ignore until the next rebuild.
  }
}

/** A light tick for crossing a selection boundary (e.g. an index rail). */
export function selectionTick() {
  safe(() => Haptics.selectionAsync());
}

const IMPACT = {
  light: Haptics.ImpactFeedbackStyle.Light,
  medium: Haptics.ImpactFeedbackStyle.Medium,
  heavy: Haptics.ImpactFeedbackStyle.Heavy,
} as const;

/** A physical bump — e.g. a swipe arming a reply, or a menu opening on long-press.
 * Safe to call from a `runOnJS` boundary (the style is a plain string key). */
export function impact(style: keyof typeof IMPACT = 'medium') {
  safe(() => Haptics.impactAsync(IMPACT[style]));
}

/** A confirmation tick for rare, completed success states. */
export function successFeedback() {
  if (process.env.EXPO_OS === 'android') {
    safe(() => Haptics.performAndroidHapticsAsync(Haptics.AndroidHaptics.Confirm));
    return;
  }
  safe(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success));
}
