import ChevronLeft from 'lucide-react-native/icons/chevron-left';
import ChevronRight from 'lucide-react-native/icons/chevron-right';
import type { ComponentProps } from 'react';

import { useIsRTL } from '@/i18n/direction';
import { iconStrokeWidth } from '@/theme/icons';

type Props = ComponentProps<typeof ChevronRight>;

/** A forward/navigation chevron that follows the resolved app direction. */
export function DirectionalChevron({ style, ...props }: Props) {
  const isRTL = useIsRTL();
  const Chevron = isRTL ? ChevronLeft : ChevronRight;
  return <Chevron strokeWidth={iconStrokeWidth.default} {...props} style={style} />;
}
