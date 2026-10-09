import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { AccessibilityInfo, View } from 'react-native';
import { LinearTransition } from 'react-native-reanimated';

import { manipulationTiming } from '@/theme/motion';

/** Layout changes run natively without subscribing the pager to animation frames. */
export const mediaChromeLayout = LinearTransition
  .duration(manipulationTiming.duration)
  .easing(manipulationTiming.easing)
  .reduceMotion(manipulationTiming.reduceMotion);

const MediaChromeContext = createContext<{
  visible: boolean;
  screenReaderEnabled: boolean;
  interactionVersion: number;
  setVisible: (visible: boolean | ((previous: boolean) => boolean)) => void;
  touchControls: () => void;
} | null>(null);

/** Shared visibility without putting playback ticks into the media pager. */
export function MediaChromeProvider({ children }: { children: ReactNode }) {
  const [visible, setVisible] = useState(true);
  const [screenReaderEnabled, setScreenReaderEnabled] = useState(false);
  const [interactionVersion, setInteractionVersion] = useState(0);
  const touchControls = useCallback(() => {
    setVisible(true);
    setInteractionVersion((value) => value + 1);
  }, []);
  useEffect(() => {
    let active = true;
    void AccessibilityInfo.isScreenReaderEnabled().then((enabled) => {
      if (active) setScreenReaderEnabled(enabled);
    }).catch(() => {});
    const subscription = AccessibilityInfo.addEventListener('screenReaderChanged', setScreenReaderEnabled);
    return () => { active = false; subscription.remove(); };
  }, []);
  return (
    <MediaChromeContext.Provider value={{ visible, screenReaderEnabled, interactionVersion, setVisible, touchControls }}>
      {children}
    </MediaChromeContext.Provider>
  );
}

export function useMediaChrome() {
  const chrome = useContext(MediaChromeContext);
  if (!chrome) throw new Error('Media chrome requires MediaChromeProvider');
  return chrome;
}

/** Top actions share the video's idle timer and refresh it on interaction. */
export function MediaTopChrome({ children }: { children: ReactNode }) {
  const { visible, screenReaderEnabled, touchControls } = useMediaChrome();
  const shown = visible || screenReaderEnabled;
  return (
    <View
      testID="media-top-chrome"
      pointerEvents={shown ? 'box-none' : 'none'}
      onTouchStart={touchControls}
      accessibilityElementsHidden={!shown}
      importantForAccessibility={shown ? 'auto' : 'no-hide-descendants'}
      style={{ flex: 1, opacity: shown ? 1 : 0 }}
    >
      {children}
    </View>
  );
}
