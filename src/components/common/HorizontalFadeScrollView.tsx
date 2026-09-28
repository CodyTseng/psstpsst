import {
  forwardRef,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';
import {
  ScrollView,
  type ScrollViewProps,
  type StyleProp,
  View,
  type ViewStyle,
} from 'react-native';

import { useLanguageDirection } from '@/i18n/direction';
import { IS_ELECTRON } from '@/lib/platform';
import { horizontalRailLayout, spacing } from '@/theme';

import { EdgeFade } from './EdgeFade';

type Props = Omit<ScrollViewProps, 'horizontal' | 'showsHorizontalScrollIndicator'> & {
  fadeColor: string;
  fadeWidth?: number;
  containerStyle?: StyleProp<ViewStyle>;
};

type FadeVisibility = { start: boolean; end: boolean };

/** Horizontal scrolling surface with logical-edge overflow fades. Visibility
 * changes cross into React only when the scroll reaches or leaves an edge. */
export const HorizontalFadeScrollView = forwardRef<ScrollView, Props>(
  function HorizontalFadeScrollView(
    {
      children,
      containerStyle,
      contentContainerStyle,
      fadeColor,
      fadeWidth = horizontalRailLayout.fadeWidth,
      onContentSizeChange,
      onLayout,
      onScroll,
      scrollEventThrottle = 16,
      style,
      ...scrollProps
    },
    ref,
  ) {
    const direction = useLanguageDirection();
    const viewportWidthRef = useRef(0);
    const contentWidthRef = useRef(0);
    const scrollXRef = useRef(0);
    const visibilityRef = useRef<FadeVisibility>({ start: false, end: false });
    const [visibility, setVisibility] = useState<FadeVisibility>({
      start: false,
      end: false,
    });

    const updateVisibility = useCallback(() => {
      const viewportWidth = viewportWidthRef.current;
      const contentWidth = contentWidthRef.current;
      const scrollX = scrollXRef.current;
      const overflowing = viewportWidth > 0 && contentWidth > viewportWidth;
      const next = {
        start:
          overflowing &&
          (direction === 'rtl'
            ? scrollX + viewportWidth < contentWidth - spacing.xs
            : scrollX > spacing.xs),
        end:
          overflowing &&
          (direction === 'rtl'
            ? scrollX > spacing.xs
            : scrollX + viewportWidth < contentWidth - spacing.xs),
      };
      const previous = visibilityRef.current;
      if (previous.start === next.start && previous.end === next.end) return;
      visibilityRef.current = next;
      setVisibility(next);
    }, [direction]);

    useEffect(() => {
      updateVisibility();
    }, [updateVisibility]);

    const electronScrollbarProps = IS_ELECTRON
      ? {
          dataSet: {
            psstpsstScrollbarHidden: 'true',
          },
        }
      : {};

    return (
      <View
        style={[
          { direction, position: 'relative' },
          containerStyle,
        ]}
      >
        <ScrollView
          {...scrollProps}
          {...electronScrollbarProps}
          ref={ref}
          horizontal
          style={[{ direction: 'ltr' }, style]}
          contentContainerStyle={[{ direction }, contentContainerStyle]}
          showsHorizontalScrollIndicator={false}
          onLayout={(event) => {
            viewportWidthRef.current = event.nativeEvent.layout.width;
            updateVisibility();
            onLayout?.(event);
          }}
          onContentSizeChange={(width, height) => {
            contentWidthRef.current = width;
            updateVisibility();
            onContentSizeChange?.(width, height);
          }}
          onScroll={(event) => {
            scrollXRef.current = event.nativeEvent.contentOffset.x;
            viewportWidthRef.current = event.nativeEvent.layoutMeasurement.width;
            contentWidthRef.current = event.nativeEvent.contentSize.width;
            updateVisibility();
            onScroll?.(event);
          }}
          scrollEventThrottle={scrollEventThrottle}
        >
          {children}
        </ScrollView>
        {visibility.start ? (
          <EdgeFade edge="start" color={fadeColor} width={fadeWidth} />
        ) : null}
        {visibility.end ? (
          <EdgeFade edge="end" color={fadeColor} width={fadeWidth} />
        ) : null}
      </View>
    );
  },
);
