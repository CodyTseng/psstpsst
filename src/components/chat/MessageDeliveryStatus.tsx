import Check from 'lucide-react-native/icons/check';
import { DangerCircle as CircleAlert } from '@solar-icons/react-native/category/ui/Linear/DangerCircle';
import { ClockCircle as Clock } from '@solar-icons/react-native/category/time/Linear/ClockCircle';

import { type MessageDelivery } from '@/stores/delivery-status.store';
import { iconStrokeWidth } from '@/theme/icons';
import { useThemeColors } from '@/theme';

export const MESSAGE_DELIVERY_ICON_SIZE = 11;

type Props = {
  delivery: MessageDelivery;
  /** Base color — matches the bubble's metadata text. Failures override to
   * danger. */
  color: string;
};

/**
 * Inline delivery glyph next to the timestamp inside the bubble:
 *   signing / sending → a clock (pending)
 *   sent (delivered by majority) → a check
 *   failed → a danger alert
 * Just the glyph — the surrounding metadata (time + this) is the tap target that
 * opens the per-relay sheet; the exact `n/m` lives there.
 */
export function MessageDeliveryStatus({ delivery, color }: Props) {
  const c = useThemeColors();

  let Icon = Clock;
  let iconColor = color;
  if (delivery.phase === 'sent') {
    Icon = Check;
  } else if (delivery.phase === 'failed') {
    Icon = CircleAlert;
    iconColor = c.danger;
  }

  return (
    <Icon
      strokeWidth={delivery.phase === 'sent' ? iconStrokeWidth.compact : undefined}
      size={MESSAGE_DELIVERY_ICON_SIZE}
      color={iconColor}
    />
  );
}
