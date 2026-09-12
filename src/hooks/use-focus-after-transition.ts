import { useNavigation } from 'expo-router';
import { useEffect, useRef } from 'react';
import type { TextInput } from 'react-native';

/**
 * Returns a ref to attach to an auto-focused input (`AppInput` / `SearchBar`),
 * focusing it once **after the screen's initial push transition finishes** — the
 * app-wide way to auto-focus, instead of the `autoFocus` prop. Returning from a
 * child route does not focus it again.
 *
 * `autoFocus` focuses on mount, which on a pushed screen happens *while it is
 * still sliding in*: the keyboard rises and slides in together with the page, a
 * jarring double-motion. Waiting for `transitionEnd` lets the page settle first,
 * then the keyboard rises on its own — two clean, sequential steps.
 *
 * The listener attaches a few ms into the (~350ms) transition, well before it
 * ends, so the focus reliably fires for any navigated-to screen.
 */
export function useFocusAfterTransition<T extends TextInput = TextInput>() {
  const ref = useRef<T>(null);
  const focusedOnce = useRef(false);
  const navigation = useNavigation();
  useEffect(() => {
    // Focus only after this screen's initial entrance. Returning from a child
    // route must preserve the keyboard state the user left behind.
    const unsubscribe = navigation.addListener(
      'transitionEnd' as never,
      ((e: { data?: { closing?: boolean } }) => {
        if (e.data?.closing || focusedOnce.current || !ref.current) return;
        focusedOnce.current = true;
        ref.current.focus();
      }) as never,
    );
    return unsubscribe;
  }, [navigation]);
  return ref;
}
