import { forwardRef } from 'react';
import { View, type ViewProps } from 'react-native';
import Animated from 'react-native-reanimated';

import { mediaChromePointerStyles } from './media-chrome-styles';

type Props = ViewProps & { blocked?: boolean };

const MediaChromeView = forwardRef<View, Props>(function MediaChromeView(
  { blocked = false, style, ...props }, ref,
) {
  // Reanimated copies styles before rendering its child. Apply registered
  // pointer styles here so React Native Web can still compile box-none rules.
  return (
    <View
      {...props}
      ref={ref}
      style={[style, blocked ? mediaChromePointerStyles.hidden : mediaChromePointerStyles.passthrough]}
    />
  );
});

export const AnimatedMediaChromeView = Animated.createAnimatedComponent(MediaChromeView);
