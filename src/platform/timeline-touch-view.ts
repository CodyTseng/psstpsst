import { requireNativeViewManager, requireOptionalNativeModule } from 'expo-modules-core';
import type { ComponentType } from 'react';
import { Platform, type ViewProps } from 'react-native';

type TimelineTouchViewProps = ViewProps & {
  onTouchCancelled: () => void;
};

let nativeView: ComponentType<TimelineTouchViewProps> | null | undefined;

/** Older Android builds still render the ordinary timeline container. */
export function getTimelineTouchView(): ComponentType<TimelineTouchViewProps> | null {
  if (Platform.OS !== 'android') return null;
  if (nativeView === undefined) {
    nativeView = requireOptionalNativeModule('ExpoTimelineTouch')
      ? requireNativeViewManager<TimelineTouchViewProps>('ExpoTimelineTouch')
      : null;
  }
  return nativeView;
}
