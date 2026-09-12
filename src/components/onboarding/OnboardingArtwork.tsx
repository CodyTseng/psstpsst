import { View } from 'react-native';

import { BrandArtworkImage } from '@/components/common/BrandArtworkImage';
import { useDesktopWindowDragRegion } from '@/components/common/DesktopWindowFrame';
import { EdgeFade } from '@/components/common/EdgeFade';
import { spacing, wideLayout } from '@/theme';

type Props = {
  wide: boolean;
  fadeColor: string;
};

/**
 * Shared onboarding artwork: a bounded rail on wide layouts and a stacked
 * hero on narrow ones.
 */
export function OnboardingArtwork({ wide, fadeColor }: Props) {
  const dragRef = useDesktopWindowDragRegion();

  return (
    <View
      ref={dragRef}
      style={[
        { minWidth: 0, position: 'relative' },
        wide
          ? {
              width: wideLayout.onboardingArtworkWidth,
              maxWidth: wideLayout.onboardingArtworkMaxWidth,
              flexShrink: 0,
            }
          : { flex: 1, width: '100%' },
      ]}
    >
      <BrandArtworkImage
        contentPosition={wide ? 'center' : 'bottom'}
        style={{ width: '100%', height: '100%' }}
      />
      {wide ? null : (
        <EdgeFade edge="bottom" color={fadeColor} height={spacing['3xl']} />
      )}
    </View>
  );
}
