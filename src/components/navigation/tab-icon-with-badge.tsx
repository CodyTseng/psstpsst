import { type ReactNode } from 'react';
import { View } from 'react-native';

import { CountBadge } from '@/components/common/CountBadge';
import { spacing } from '@/theme';

export function TabIconWithBadge({ children, count }: { children: ReactNode; count: number }) {
  return (
    <View pointerEvents="none" style={{ alignItems: 'center', justifyContent: 'center' }}>
      {children}
      {count > 0 ? (
        <View style={{ position: 'absolute', top: -spacing.xs, end: -spacing.sm }}>
          <CountBadge count={count} size="sm" />
        </View>
      ) : null}
    </View>
  );
}
