import { forwardRef } from 'react';
import {
  ScrollView,
  type ScrollViewProps,
  type StyleProp,
  View,
  type ViewStyle,
} from 'react-native';

import { useLanguageDirection } from '@/i18n/direction';
import { IS_ELECTRON } from '@/lib/platform';

type Props = Omit<ScrollViewProps, 'horizontal' | 'showsHorizontalScrollIndicator'> & {
  containerStyle?: StyleProp<ViewStyle>;
};

/** Horizontal content reaches the viewport edges; content padding owns resting gutters. */
export const HorizontalScrollView = forwardRef<ScrollView, Props>(
  function HorizontalScrollView(
    { children, containerStyle, contentContainerStyle, scrollEventThrottle = 16, style, ...scrollProps },
    ref,
  ) {
    const direction = useLanguageDirection();
    const electronScrollbarProps = IS_ELECTRON
      ? { dataSet: { psstpsstScrollbarHidden: 'true' } }
      : {};

    return (
      <View style={[{ direction }, containerStyle]}>
        <ScrollView
          {...scrollProps}
          {...electronScrollbarProps}
          ref={ref}
          horizontal
          style={[{ direction: 'ltr' }, style]}
          contentContainerStyle={[{ direction }, contentContainerStyle]}
          showsHorizontalScrollIndicator={false}
          scrollEventThrottle={scrollEventThrottle}
        >
          {children}
        </ScrollView>
      </View>
    );
  },
);
