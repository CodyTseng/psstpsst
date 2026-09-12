import { Stack } from 'expo-router';
import { useWindowDimensions, View } from 'react-native';

import { useImmersiveDesktopTitlebar } from '@/components/common/DesktopWindowFrame';
import { OnboardingArtwork } from '@/components/onboarding/OnboardingArtwork';
import { isWideLayoutSize } from '@/lib/layout/wide-layout';
import { useThemeColors } from '@/theme';

/**
 * The sign-in flow. Deliberately *not* guarded against an already-active account:
 * the same screens are reused to **add a second account** while logged in (the
 * account switcher routes here). On launch a signed-in user is sent straight to
 * the app by the `(app)` group's own guard, so they never land here unless they
 * explicitly chose to add an account — at which point each screen's
 * `addAccount* → setActive` switches the session over to the new identity.
 */
export default function OnboardingLayout() {
  const c = useThemeColors();
  const { width, height } = useWindowDimensions();
  const wide = isWideLayoutSize(width, height);
  useImmersiveDesktopTitlebar(wide);

  return (
    <View style={{ flex: 1, flexDirection: wide ? 'row' : 'column' }}>
      {wide ? <OnboardingArtwork wide fadeColor={c.background} /> : null}
      <View style={{ flex: 1, minWidth: 0, backgroundColor: c.background }}>
        <Stack
          screenOptions={{ headerShown: false, contentStyle: { backgroundColor: c.background } }}
        />
      </View>
    </View>
  );
}
