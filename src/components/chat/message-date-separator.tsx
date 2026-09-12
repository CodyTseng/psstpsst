import { View } from 'react-native';

import { AppText } from '@/components/common/AppText';
import { FrostedBackdrop } from '@/components/common/FrostedBackdrop';
import { radius, spacing } from '@/theme';

/** The rounded date capsule shared by inline and floating chat separators. */
export function DatePill({ label }: { label: string }) {
  return (
    <View
      style={{
        borderRadius: radius.full,
        overflow: 'hidden',
        paddingHorizontal: spacing.md,
        paddingVertical: 3,
      }}
    >
      <FrostedBackdrop surface="surfaceMuted" />
      <AppText variant="caption" tone="subtle">
        {label}
      </AppText>
    </View>
  );
}

/** Centered date pill between messages on a day boundary. */
export function DateSeparator({ label }: { label: string }) {
  return (
    <View style={{ alignItems: 'center', marginVertical: spacing.sm }}>
      <DatePill label={label} />
    </View>
  );
}
