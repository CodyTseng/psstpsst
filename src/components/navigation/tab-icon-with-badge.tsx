import { type ReactNode } from 'react';
import { View } from 'react-native';

import { CountBadge } from '@/components/common/CountBadge';
import { NotificationDot } from '@/components/common/NotificationDot';
import { spacing } from '@/theme';

type Props = { children: ReactNode } & (
  | { count: number; dot?: never }
  | { dot: boolean; count?: never }
);

export function TabIconWithBadge({ children, count, dot }: Props) {
  return (
    <View pointerEvents="none" style={{ alignItems: 'center', justifyContent: 'center' }}>
      {children}
      {dot || (count ?? 0) > 0 ? (
        <View style={{
          position: 'absolute',
          top: dot ? -spacing.xs / 2 : -spacing.xs,
          end: dot ? -spacing.xs / 2 : -spacing.sm,
        }}>
          {dot ? <NotificationDot /> : <CountBadge count={count ?? 0} size="sm" />}
        </View>
      ) : null}
    </View>
  );
}
