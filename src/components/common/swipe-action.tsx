import { InteractivePressable as Pressable } from '@/components/common/InteractivePressable';

import { AppText } from './AppText';
import { InteractionOverlay } from './InteractionOverlay';

export const SWIPE_ACTION_WIDTH = 80;

/** Fixed-width icon-over-label cell shared by list-row swipe actions. */
export function SwipeAction({
  onPress,
  icon,
  label,
  color,
  bgRest,
}: {
  onPress: () => void;
  icon: React.ReactNode;
  label: string;
  color: string;
  bgRest: string;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      fallbackHoverOpacity={false}
      style={{
        width: SWIPE_ACTION_WIDTH,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: bgRest,
        gap: 4,
      }}
    >
      {({ pressed }) => (
        <>
          {pressed ? <InteractionOverlay /> : null}
          {icon}
          <AppText variant="caption" weight="medium" numberOfLines={1} style={{ color }}>
            {label}
          </AppText>
        </>
      )}
    </Pressable>
  );
}
