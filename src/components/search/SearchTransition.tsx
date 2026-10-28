import { type ReactNode, useEffect, useRef, useState } from 'react';
import { Animated, StyleSheet, View } from 'react-native';

import { useEmptySearchScroll } from '@/hooks/use-empty-search-scroll';

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
  const [retainedContent, setRetainedContent] = useState<{ node: ReactNode } | null>(
    () => contentActive ? { node: activeContent } : null,
  );
  const restingSurface = useRef<View>(null);

  // React retries this component before committing its children, so activating
  // the overlay retains its last search props through the exit animation.
  // Otherwise clearing the query replaces fading results with the full list.
  if (contentActive && (!retainedContent || retainedContent.node !== activeContent)) {
    setRetainedContent({ node: activeContent });
  }

  useEffect(() => {
    const animation = Animated.timing(progress, {
      toValue: contentActive ? 1 : 0,
      duration: SEARCH_ACTIVATION_TRANSITION_MS,
      useNativeDriver: true,
    });
    animation.start(({ finished }) => {
      if (finished && !contentActive) setRetainedContent(null);
    });
    return () => animation.stop();
  }, [contentActive, progress]);

  useEffect(() => {
    if (!focused && active) onCancel();
  }, [active, focused, onCancel]);

  useEmptySearchScroll(restingSurface, focused && active && !contentActive, onCancel);

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
        ref={restingSurface}
        style={[
          StyleSheet.absoluteFill,
          {
            opacity: progress.interpolate({
              inputRange: [0, 1],
              outputRange: [1, 0],
            }),
          }, { pointerEvents: contentActive ? 'none' : 'auto' }]}
      >
        {children}
      </Animated.View>

      {contentActive || retainedContent ? (
        <Animated.View
          style={[StyleSheet.absoluteFill, styles.active, { opacity: progress }, { pointerEvents: contentActive ? 'auto' : 'none' }]}
        >
          {contentActive ? activeContent : retainedContent?.node}
        </Animated.View>
      ) : null}

      {activeChrome && (active || retainedContent) ? (
        <View
          style={[StyleSheet.absoluteFill, styles.activeChrome, { pointerEvents: active ? 'box-none' : 'none' }]}
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
