import type { ReactNode } from 'react';
import { useWindowDimensions, View } from 'react-native';

import { ScreenHeader, useScreenHeaderClearance } from '@/components/common/ScreenHeader';
import { isWideLayoutSize } from '@/lib/layout/wide-layout';
import { IS_ELECTRON } from '@/lib/platform';
import { desktopChrome, useThemeColors } from '@/theme';

type Props = {
  children: ReactNode;
  title: string;
  bordered: boolean;
};

/** Keeps pushed onboarding forms visually connected to the wide welcome screen. */
export function OnboardingFormLayout({ children, title, bordered }: Props) {
  const c = useThemeColors();
  const { width, height } = useWindowDimensions();
  const wide = isWideLayoutSize(width, height);
  const titleClearance = useScreenHeaderClearance();
  const titlebarClearance = wide && IS_ELECTRON ? desktopChrome.titlebarHeight : 0;

  return (
    <View
      style={{
        flex: 1,
        minWidth: 0,
        position: 'relative',
        paddingTop: titleClearance + titlebarClearance,
        backgroundColor: c.background,
      }}
    >
      {children}
      <ScreenHeader bordered={bordered} title={title} topOffset={titlebarClearance} />
    </View>
  );
}
