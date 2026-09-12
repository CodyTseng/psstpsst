import { useId } from 'react';
import Svg, { Defs, LinearGradient as SvgGradient, Rect, Stop } from 'react-native-svg';

import { useIsRTL } from '@/i18n/direction';

type VerticalProps = {
  /** Which edge to pin the fade to. */
  edge: 'top' | 'bottom';
  /** The colour to fade **from** — opaque at the edge, transparent inward. Match
   * the surface the scrolling content sits on (e.g. `c.background` on a screen,
   * `c.sheetBackground` inside a sheet) so content dissolves into it. */
  color: string;
  /** Fade height in px. */
  height: number;
  width?: never;
};

type HorizontalProps = {
  /** Which logical edge to pin the fade to. */
  edge: 'start' | 'end';
  /** The colour to fade from — opaque at the edge, transparent inward. */
  color: string;
  /** Fade width in px. */
  width: number;
  height?: never;
  /** Reverse the default opaque-edge to transparent-inward direction. */
  reverse?: boolean;
};

type Props = VerticalProps | HorizontalProps;

/**
 * A fade pinned to one edge of a scroll area — opaque at the edge, transparent
 * inward — so content dissolves into the background instead of being
 * hard-clipped. (DESIGN §8.)
 *
 * Place it as the **last child** of a `position: relative` box that wraps the
 * scroll view (absolute, so it overlays the scroll's edge), and **pad the scroll
 * content by `height`** at that end so the first/last item can still clear the
 * fade at rest. A `react-native-svg` gradient; `pointerEvents` off.
 */
export function EdgeFade(props: Props) {
  const isRTL = useIsRTL();
  const { edge, color } = props;
  const horizontal = edge === 'start' || edge === 'end';
  const fadeSize = horizontal
    ? (props as HorizontalProps).width
    : (props as VerticalProps).height;
  const edgeAtLeft =
    horizontal && (edge === 'start') !== isRTL;
  const reverse = horizontal && (props as HorizontalProps).reverse === true;
  const opaqueAtLeft = horizontal && (reverse ? !edgeAtLeft : edgeAtLeft);
  // Unique per instance so two fades (or two screens) never share a gradient id;
  // strip the colons `useId` emits, which aren't valid in an SVG `url(#…)` ref.
  const id = `edge-fade-${edge}-${useId().replace(/:/g, '')}`;
  return (
    <Svg
      width={horizontal ? fadeSize : '100%'}
      height={horizontal ? '100%' : fadeSize}
      style={{
        position: 'absolute',
        // Resolve logical horizontal edges to physical coordinates here. RN Web
        // maps `start`/`end` from the native I18nManager direction, which can
        // differ from the app language after an in-place language switch.
        left: horizontal ? (edgeAtLeft ? 0 : undefined) : 0,
        right: horizontal ? (edgeAtLeft ? undefined : 0) : 0,
        top: edge === 'top' ? 0 : undefined,
        bottom: edge === 'bottom' ? 0 : undefined,
        ...(horizontal ? { top: 0, bottom: 0 } : undefined),
        pointerEvents: 'none',
      }}
    >
      <Defs>
        <SvgGradient
          id={id}
          x1={horizontal ? '0%' : '0'}
          y1={horizontal ? '0' : edge === 'top' ? '0' : '1'}
          x2={horizontal ? '100%' : '0'}
          y2={horizontal ? '0' : edge === 'top' ? '1' : '0'}
        >
          <Stop
            offset="0"
            stopColor={color}
            stopOpacity={horizontal ? (opaqueAtLeft ? 1 : 0) : 1}
          />
          <Stop
            offset="1"
            stopColor={color}
            stopOpacity={horizontal ? (opaqueAtLeft ? 0 : 1) : 0}
          />
        </SvgGradient>
      </Defs>
      <Rect x="0" y="0" width="100%" height="100%" fill={`url(#${id})`} />
    </Svg>
  );
}
