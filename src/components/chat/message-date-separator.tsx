import { useLayoutEffect } from 'react';
import { View } from 'react-native';

import { AppText } from '@/components/common/AppText';
import { FrostedBackdrop } from '@/components/common/FrostedBackdrop';
import { radius, spacing } from '@/theme';
import type { MessageCellFrame } from './message-row-layout';

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
export function DateSeparator({ label, cellKey, onFrame }: {
  label: string;
  cellKey?: string;
  onFrame?: (key: string, frame: MessageCellFrame | null) => void;
}) {
  useLayoutEffect(() => {
    if (cellKey && onFrame) return () => onFrame(cellKey, null);
  }, [cellKey, onFrame]);
  return (
    <View
      style={{ alignItems: 'center', marginVertical: spacing.sm }}
      onLayout={cellKey && onFrame ? ({ nativeEvent }) => onFrame(cellKey, nativeEvent.layout) : undefined}
    >
      <DatePill label={label} />
    </View>
  );
}
