import { type ReactNode } from 'react';
import { View } from 'react-native';

import { spacing } from '@/theme';

type Props = {
  leading?: ReactNode;
  metaSlot?: ReactNode;
};

/**
 * Shared footer geometry for message cards. The card owns its horizontal and
 * bottom padding; this row consistently separates footer content from the body
 * and pins message metadata to the trailing edge.
 */
export function MessageCardFooter({ leading, metaSlot }: Props) {
  if (!leading && !metaSlot) return null;

  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: spacing.sm,
        marginTop: spacing.sm,
      }}
    >
      <View style={{ flex: 1, minWidth: 0 }}>{leading}</View>
      {metaSlot ? <View style={{ flexShrink: 0 }}>{metaSlot}</View> : null}
    </View>
  );
}
