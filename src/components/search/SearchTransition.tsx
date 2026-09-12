import { type ReactNode, useEffect, useState } from 'react';
import { Animated, StyleSheet, View } from 'react-native';

import { isSearchActivationShortcut } from '@/components/search/search-shortcut';

export const SEARCH_ACTIVATION_TRANSITION_MS = 250;

type Props = {
  active: boolean;
  contentActive?: boolean;
  activeContent: ReactNode;
  activeChrome?: ReactNode;
  focused?: boolean;
  onActivate: () => void;
  onCancel: () => void;
  children: ReactNode;
};

/**
 * Shared state-preserving transition between a tab's resting list and its
 * search surface. The resting content stays mounted to retain scroll state.
 * `contentActive` lets the editable search chrome remain visible while an empty
 * query continues to show the resting list beneath it.
 */
export function SearchTransition({
  active,
  contentActive = active,
  activeContent,
  activeChrome,
  focused = true,
  onActivate,
  onCancel,
  children,
}: Props) {
  const [progress] = useState(() => new Animated.Value(contentActive ? 1 : 0));
  const [keepActiveMounted, setKeepActiveMounted] = useState(contentActive);

  // React retries this component before committing its children, so activating
  // the overlay records that it must survive a later closing render without
  // adding an effect-driven intermediate frame.
  if (contentActive && !keepActiveMounted) setKeepActiveMounted(true);

  useEffect(() => {
    const animation = Animated.timing(progress, {
      toValue: contentActive ? 1 : 0,
      duration: SEARCH_ACTIVATION_TRANSITION_MS,
      useNativeDriver: true,
    });
    animation.start(({ finished }) => {
      if (finished && !contentActive) setKeepActiveMounted(false);
    });
    return () => animation.stop();
  }, [contentActive, progress]);

  useEffect(() => {
    if (!focused && active) onCancel();
  }, [active, focused, onCancel]);

  useEffect(() => {
    if (!focused || typeof document === 'undefined') return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (active && event.key === 'Escape') {
        event.preventDefault();
        onCancel();
        return;
      }
      if (isSearchActivationShortcut(event)) {
        event.preventDefault();
        if (!active) onActivate();
      }
    };
    // React Native Web's TextInput stops keydown propagation, so listen during
    // capture before the focused field consumes the event.
    document.addEventListener('keydown', handleKeyDown, true);
    return () => document.removeEventListener('keydown', handleKeyDown, true);
  }, [active, focused, onActivate, onCancel]);

  return (
    <View style={styles.root}>
      <Animated.View
        pointerEvents={contentActive ? 'none' : 'auto'}
        style={[
          StyleSheet.absoluteFill,
          {
            opacity: progress.interpolate({
              inputRange: [0, 1],
              outputRange: [1, 0],
            }),
          },
        ]}
      >
        {children}
      </Animated.View>

      {contentActive || keepActiveMounted ? (
        <Animated.View
          pointerEvents={contentActive ? 'auto' : 'none'}
          style={[StyleSheet.absoluteFill, styles.active, { opacity: progress }]}
        >
          {activeContent}
        </Animated.View>
      ) : null}

      {activeChrome && (active || keepActiveMounted) ? (
        <View
          pointerEvents={active ? 'box-none' : 'none'}
          style={[StyleSheet.absoluteFill, styles.activeChrome]}
        >
          {activeChrome}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  active: {
    zIndex: 1,
  },
  activeChrome: {
    zIndex: 2,
  },
});
