import { BlurView } from 'expo-blur';
import { StyleSheet, View } from 'react-native';

import { IS_ANDROID } from '@/lib/platform';
import { useEffectiveColorScheme, useThemeColors } from '@/theme';

type FrostedSurface = 'background' | 'surfaceMuted' | 'surfaceElevated';

type Props = {
  /** Original semantic surface colour; frost changes opacity, never its hue. */
  surface: FrostedSurface;
};

/** The single parameter set and renderer for the app's restrained frost. */
const FROST_INTENSITY = 80;
const FROST_OPACITY = 0.86;

/**
 * Shared frosted material for chrome and small floating capsules. Android never
 * mounts BlurView: it uses the caller's opaque semantic surface instead.
 */
export function FrostedBackdrop({ surface }: Props) {
  const scheme = useEffectiveColorScheme();
  const c = useThemeColors();

  if (IS_ANDROID) {
    return (
      <View
        style={[StyleSheet.absoluteFill, { backgroundColor: c[surface], pointerEvents: 'none' }]}
      />
    );
  }

  return (
    <View style={[StyleSheet.absoluteFill, { pointerEvents: 'none' }]}>
      <BlurView
        intensity={FROST_INTENSITY}
        tint={scheme === 'dark' ? 'dark' : 'light'}
        style={StyleSheet.absoluteFill}
      />
      {/* Preserve the surface's original colour. Frost adds only opacity and
          blur, so adopting the material never changes the semantic hue. */}
      <View
        style={[
          StyleSheet.absoluteFill,
          { backgroundColor: c[surface], opacity: FROST_OPACITY },
        ]}
      />
    </View>
  );
}
