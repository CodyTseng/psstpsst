import { forwardRef } from 'react';
import { View, type ViewProps } from 'react-native';

import { radius, uiDensity, useThemeColors } from '@/theme';

type Variant = 'plain' | 'outlined' | 'muted';

type Props = ViewProps & {
  variant?: Variant;
};

export const AppCard = forwardRef<View, Props>(function AppCard(
  { variant = 'outlined', style, ...rest },
  ref,
) {
  const c = useThemeColors();

  const variantStyle =
    variant === 'plain'
      ? { backgroundColor: c.surface }
      : variant === 'muted'
        ? { backgroundColor: c.surfaceMuted }
        : { backgroundColor: c.surfaceElevated, borderWidth: 1, borderColor: c.border };

  return (
    <View
      {...rest}
      ref={ref}
      style={[
        {
          borderRadius: radius.xl,
          padding: uiDensity.cardPadding,
        },
        variantStyle,
        style,
      ]}
    />
  );
});
