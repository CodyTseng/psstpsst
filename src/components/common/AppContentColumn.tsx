import type { ComponentProps, ReactNode } from 'react';
import { View } from 'react-native';

import { contentWidth } from '@/theme';

type Props = {
  children: ReactNode;
  /** Whether the column should fill the available main-axis space. */
  fill?: boolean;
  style?: ComponentProps<typeof View>['style'];
};

/** A centered reading column for focused setup and recovery flows. */
export function AppContentColumn({ children, fill = true, style }: Props) {
  return (
    <View
      style={[
        {
          width: '100%',
          maxWidth: contentWidth.focused,
          alignSelf: 'center',
        },
        fill ? { flex: 1 } : null,
        style,
      ]}
    >
      {children}
    </View>
  );
}
