import { useFocusEffect } from 'expo-router';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { View } from 'react-native';

import { AppText } from '@/components/common/AppText';
import { CenteredHeaderTitle } from './CenteredHeaderTitle';
import { DESKTOP_OS, IS_ELECTRON } from '@/lib/platform';
import { platform } from '@/platform';
import { useThemeStore } from '@/stores/theme.store';
import { serializeAccent } from '@/theme/accents';
import { desktopChrome, spacing, uiDensity, useThemeColors, ThemeColorsContext, type ThemeColors } from '@/theme';

const TITLEBAR_HEIGHT = desktopChrome.titlebarHeight;
type WindowTitlebar = { title?: string; actions?: ReactNode; navigation?: ReactNode; navigationWidth?: number; colors?: ThemeColors };
const WindowTitlebarContext = createContext<(value: WindowTitlebar | null) => void>(() => {});

/** Application hosts place their existing actions in the window's single title bar. */
export function useDesktopWindowTitlebar(value: WindowTitlebar | null) {
  const setTitlebar = useContext(WindowTitlebarContext);
  const title = value?.title, actions = value?.actions, navigation = value?.navigation, navigationWidth = value?.navigationWidth, colors = value?.colors, enabled = value !== null;
  useLayoutEffect(() => { if (IS_ELECTRON && enabled) setTitlebar({ title, actions, navigation, navigationWidth, colors }); }, [setTitlebar, title, actions, navigation, navigationWidth, colors, enabled]);
  useLayoutEffect(() => () => { if (IS_ELECTRON && enabled) setTitlebar(null); }, [setTitlebar, enabled]);
}

const ImmersiveTitlebarContext = createContext<(enabled: boolean) => void>(() => {});

/** Marks a non-interactive Electron surface as a native window drag region. */
export function useDesktopWindowDragRegion(draggable = true) {
  const dragRef = useRef<View>(null);

  useEffect(() => {
    if (!IS_ELECTRON) return;

    // `-webkit-app-region: drag` has no React Native style equivalent; apply it
    // to the host node directly.
    const node = dragRef.current as unknown as HTMLElement | null;
    node?.style.setProperty('-webkit-app-region', draggable ? 'drag' : 'no-drag');
    return () => {
      node?.style.removeProperty('-webkit-app-region');
    };
  }, [draggable]);

  return dragRef;
}

/** Lets a focused Electron route extend its content behind the native title bar. */
export function useImmersiveDesktopTitlebar(enabled: boolean) {
  const setImmersive = useContext(ImmersiveTitlebarContext);
  useFocusEffect(
    useCallback(() => {
      if (!IS_ELECTRON || !enabled) return;
      setImmersive(true);
      return () => setImmersive(false);
    }, [enabled, setImmersive]),
  );
}

/**
 * Same effect as {@link useImmersiveDesktopTitlebar}, but for surfaces rendered
 * outside the navigator (the boot screen), where `useFocusEffect` has no
 * navigation context: immersive for as long as the surface stays mounted.
 */
export function useImmersiveDesktopTitlebarWhileMounted(enabled: boolean) {
  const setImmersive = useContext(ImmersiveTitlebarContext);
  useEffect(() => {
    if (!IS_ELECTRON || !enabled) return;
    setImmersive(true);
    return () => setImmersive(false);
  }, [enabled, setImmersive]);
}

/**
 * The desktop window's draggable title bar. Normally it is a muted strip with
 * the centred product name. An immersive route turns it into a transparent
 * overlay so artwork continues beneath the OS caption buttons.
 */
function DesktopTitlebar({ immersive, application, applicationWindow, defaultTitle = 'PsstPsst' }: { immersive: boolean; application: WindowTitlebar | null; applicationWindow: boolean; defaultTitle?: string }) {
  const hostColors = useThemeColors();
  const c = application?.colors ?? hostColors;
  const preference = useThemeStore(state => state.preference);
  const accent = useThemeStore(state => serializeAccent(state.accent));
  const appearanceLoaded = useThemeStore(state => state.loaded);
  const dragRef = useDesktopWindowDragRegion();
  const actionRef = useDesktopWindowDragRegion(false);
  const navigationRef = useDesktopWindowDragRegion(false);
  const navigationWidth = application?.navigationWidth ?? 0;
  const titleSideInset = application
    ? Math.max((DESKTOP_OS === 'darwin' ? desktopChrome.nativeControlsWidth : 0) + navigationWidth,
      (DESKTOP_OS === 'darwin' ? 0 : desktopChrome.nativeControlsWidth) + (application.actions ? uiDensity.headerActionSize : 0)) + spacing.sm + spacing.lg
    : desktopChrome.nativeControlsWidth;
  const height = applicationWindow || application ? desktopChrome.applicationTitlebarHeight : TITLEBAR_HEIGHT;
  const title = application?.title ?? defaultTitle;
  useLayoutEffect(() => {
    if (DESKTOP_OS === 'darwin') return;
    const node = actionRef.current as unknown as HTMLElement | null;
    // Electron exposes the usable title-bar rectangle in CSS pixels, including zoom.
    node?.style.setProperty('right', `calc(100vw - env(titlebar-area-x, 0px) - env(titlebar-area-width, calc(100vw - ${desktopChrome.nativeControlsWidth}px)) + ${spacing.sm}px)`);
  }, [actionRef]);
  useEffect(() => { void platform.windowChrome.setTitle(title).catch(() => {}); }, [title]);

  // Match the OS-painted frame parts to the active title-bar palette without
  // changing the host's persisted appearance preference.
  useEffect(() => {
    void platform.windowChrome.setTheme({
      ...(appearanceLoaded ? { appearance: { preference, accent } } : {}),
      backgroundColor: c.background,
      titlebarColor: c.surfaceMuted,
      symbolColor: c.text,
      transparentTitlebar: immersive,
      titlebarHeight: height,
    });
  }, [c.background, c.surfaceMuted, c.text, immersive, height, appearanceLoaded, preference, accent]);

  return (
    <ThemeColorsContext.Provider value={c}><View
      ref={dragRef}
      testID="desktop-window-titlebar"
      style={{
        height,
        backgroundColor: immersive ? undefined : c.surfaceMuted,
        alignItems: 'center',
        justifyContent: 'center',
        ...(immersive
          ? {
              position: 'absolute',
              top: 0,
              start: 0,
              end: 0,
              zIndex: 2,
            }
          : undefined),
      }}
    >
      {immersive ? null : (
        <CenteredHeaderTitle sideInset={titleSideInset}>
          <AppText variant="caption" numberOfLines={1} ellipsizeMode="tail" align="center" style={{ userSelect: 'none', maxWidth: '100%' }}>
            {title}
          </AppText>
        </CenteredHeaderTitle>
      )}
      <View ref={navigationRef} testID="desktop-window-navigation" style={{ position: 'absolute', top: 0, bottom: 0,
        // Navigation follows the physical system caption controls on macOS.
        left: DESKTOP_OS === 'darwin' ? desktopChrome.nativeControlsWidth + spacing.sm : spacing.sm,
        justifyContent: 'center' }}>{application?.navigation}</View>
      <View ref={actionRef} style={{ position: 'absolute', top: 0, bottom: 0,
        // Native caption controls retain their physical OS position in RTL layouts.
        right: DESKTOP_OS === 'darwin' ? spacing.sm : desktopChrome.nativeControlsWidth,
        justifyContent: 'center' }}>
        {application?.actions}
      </View>
    </View></ThemeColorsContext.Provider>
  );
}

/**
 * Root frame for the Electron window: mounts normal title-bar chrome above the
 * app, or overlays it for a focused immersive route. Other runtimes render
 * children untouched.
 */
export function DesktopWindowFrame({ children, title, applicationWindow = false }: { children: ReactNode; title?: string; applicationWindow?: boolean }) {
  const c = useThemeColors();
  const [immersive, setImmersive] = useState(false);
  const [titlebar, setTitlebar] = useState<WindowTitlebar | null>(null);
  if (!IS_ELECTRON) return <>{children}</>;
  return (
    <ImmersiveTitlebarContext.Provider value={setImmersive}>
    <WindowTitlebarContext.Provider value={setTitlebar}>
      <View style={{ flex: 1, backgroundColor: c.background }}>
        <DesktopTitlebar immersive={immersive} application={titlebar} applicationWindow={applicationWindow} defaultTitle={title} />
        <View style={{ flex: 1 }}>{children}</View>
      </View>
    </WindowTitlebarContext.Provider>
    </ImmersiveTitlebarContext.Provider>
  );
}
