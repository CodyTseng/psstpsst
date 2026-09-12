import { StyleSheet, View } from 'react-native';

import { IS_ELECTRON } from '@/lib/platform';
import { useThemeColors } from '@/theme';

import { FrostedBackdrop } from './FrostedBackdrop';

type Props = {
  /** Disable frost when no content has moved beneath this chrome surface. */
  frosted?: boolean;
  /** Fixed edge this chrome occludes for Electron overlay scrollbars. */
  scrollbarOcclusion?: 'top' | 'bottom';
};

/**
 * The shared backdrop for persistent app chrome. Apple platforms and web use a
 * quiet frosted treatment; Android uses the opaque page colour because Expo's
 * non-native blur fallback is only translucent, while native blur is too costly
 * on older devices for this subtle effect.
 */
export function ChromeBackdrop({
  frosted = true,
  scrollbarOcclusion,
}: Props) {
  const c = useThemeColors();
  const electronOcclusionProps =
    IS_ELECTRON && scrollbarOcclusion
      ? {
          dataSet: {
            psstpsstScrollbarOcclusion: scrollbarOcclusion,
          },
        }
      : {};

  return (
    <View
      style={[StyleSheet.absoluteFill, { pointerEvents: 'none' }]}
      {...electronOcclusionProps}
    >
      {frosted ? (
        <FrostedBackdrop surface="background" />
      ) : (
        <View
          style={[StyleSheet.absoluteFill, { backgroundColor: c.background, pointerEvents: 'none' }]}
        />
      )}
    </View>
  );
}
