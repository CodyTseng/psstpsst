import { Navigator } from 'expo-router';
import { useEffect, useRef, type ComponentProps } from 'react';
import { useTranslation } from 'react-i18next';
import { useWindowDimensions, View } from 'react-native';
import { useReducedMotion } from 'react-native-reanimated';

// Expo Router's public Stack wraps this same view. Rendering it from the shared
// navigation builder lets a window resize change presentation without replacing
// the navigator or losing its route history.
import { NativeStackView } from 'expo-router/build/fork/native-stack/NativeStackView';

import { PrimaryPane } from './PrimaryPane';

import { AppScreenHorizontalSafeArea } from '@/components/common/AppScreen';
import { AppText } from '@/components/common/AppText';
import { useIsRTL } from '@/i18n/direction';
import {
  PRIMARY_ROUTE_NAME,
  responsiveStackRouter,
} from '@/components/navigation/responsive-stack-router';
import { getPendingWideTransitionEndRouteKey } from '@/components/navigation/wide-transition';
import { isWideLayoutSize } from '@/lib/layout/wide-layout';
import { spacing, useThemeColors } from '@/theme';

type Props = {
  backgroundColor: string;
};

/** Keeps the app's native stack on narrow windows and presents that same route
 * state as a persistent primary pane plus a detail pane on wide windows. */
export function ResponsiveAppNavigator({ backgroundColor }: Props) {
  const { width, height } = useWindowDimensions();
  const wide = isWideLayoutSize(width, height);
  const reducedMotion = useReducedMotion();

  return (
    <Navigator
      initialRouteName={PRIMARY_ROUTE_NAME}
      router={responsiveStackRouter}
      screenOptions={({ route }) => {
        const opensScanner = route.name === 'wallet-send'
          && !(route.params && 'input' in route.params && route.params.input);
        return {
          headerShown: false,
          contentStyle: { backgroundColor },
          animation: opensScanner ? (reducedMotion ? 'fade' : 'slide_from_bottom') : 'default',
          animationMatchesGesture: opensScanner,
        };
      }}
    >
      <ResponsiveNavigatorView wide={wide} width={width} />
    </Navigator>
  );
}

function ResponsiveNavigatorView({ wide, width }: { wide: boolean; width: number }) {
  const navigationContext = Navigator.useContext();
  const { state, descriptors, describe, navigation, NavigationContent } = navigationContext;

  if (!wide) {
    // `Navigator` deliberately exposes router-agnostic descriptor types. Its
    // default router is Expo Router's StackRouter, so this is the same concrete
    // prop set used by Stack even though the public generic cannot express it.
    const nativeStackProps = {
      state,
      descriptors,
      describe,
      navigation,
    } as unknown as ComponentProps<typeof NativeStackView>;
    return (
      <NavigationContent>
        <NativeStackView {...nativeStackProps} />
      </NavigationContent>
    );
  }

  return (
    <NavigationContent>
      <WideNavigatorView width={width} />
    </NavigationContent>
  );
}

function WideNavigatorView({ width }: { width: number }) {
  const c = useThemeColors();
  const isRTL = useIsRTL();
  const { state, descriptors, navigation } = Navigator.useContext();
  const primaryRoute = state.routes.find((route) => route.name === PRIMARY_ROUTE_NAME);
  const activeRoute = state.routes[state.index];
  const activeRouteKey = activeRoute?.key;
  const lastTransitionEndRouteKey = useRef<string | null>(null);
  const primaryDescriptor = primaryRoute ? descriptors[primaryRoute.key] : undefined;
  const detailDescriptor =
    activeRoute && activeRoute.name !== PRIMARY_ROUTE_NAME ? descriptors[activeRoute.key] : undefined;
  const primarySafeEdge = isRTL ? 'right' : 'left';
  const detailSafeEdge = isRTL ? 'left' : 'right';

  // Wide panes do not slide over one another. Still publish an entering
  // transition completion on the next task so screens can reuse the app-wide
  // post-transition focus and deferred-render hooks. The navigation context can
  // be recreated by event listeners, so a route instance must publish this
  // completion at most once.
  useEffect(() => {
    const routeKey = getPendingWideTransitionEndRouteKey(
      lastTransitionEndRouteKey.current,
      activeRouteKey,
    );
    if (!routeKey) return;

    const timer = setTimeout(() => {
      const routeKeyToEmit = getPendingWideTransitionEndRouteKey(
        lastTransitionEndRouteKey.current,
        activeRouteKey,
      );
      if (!routeKeyToEmit) return;

      // Set the guard before emitting because listeners can synchronously
      // recreate the navigation context.
      lastTransitionEndRouteKey.current = routeKeyToEmit;
      navigation.emit({
        type: 'transitionEnd' as never,
        target: routeKeyToEmit,
        data: { closing: false },
      } as never);
    }, 0);
    return () => clearTimeout(timer);
  }, [activeRouteKey, navigation]);

  return (
    <View style={{ flex: 1, flexDirection: 'row', backgroundColor: c.background }}>
      <AppScreenHorizontalSafeArea edges={[primarySafeEdge]}>
        <PrimaryPane windowWidth={width}>
          {primaryDescriptor?.render()}
        </PrimaryPane>
      </AppScreenHorizontalSafeArea>
      <AppScreenHorizontalSafeArea edges={[detailSafeEdge]}>
        <View style={{ flex: 1 }}>
          {detailDescriptor?.render() ?? <WideDetailPrompt />}
        </View>
      </AppScreenHorizontalSafeArea>
    </View>
  );
}

function WideDetailPrompt() {
  const { t } = useTranslation();

  return (
    <View
      style={{
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        padding: spacing.lg,
      }}
    >
      <AppText variant="body" tone="muted" align="center">
        {t('conversations.select_chat_prompt')}
      </AppText>
    </View>
  );
}
