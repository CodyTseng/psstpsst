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
import { DESKTOP_OS, IS_ELECTRON } from '@/lib/platform';
import { platform } from '@/platform';
import { desktopChrome, spacing, uiDensity, useThemeColors } from '@/theme';

const TITLEBAR_HEIGHT = desktopChrome.titlebarHeight;
type WindowTitlebar = { title?: string; actions?: ReactNode };
const WindowTitlebarContext = createContext<(value: WindowTitlebar | null) => void>(() => {});

/** Application hosts place their existing actions in the window's single title bar. */
export function useDesktopWindowTitlebar(value: WindowTitlebar | null) {
  const setTitlebar = useContext(WindowTitlebarContext);
  const title = value?.title, actions = value?.actions, enabled = value !== null;
  useLayoutEffect(() => { if (IS_ELECTRON && enabled) setTitlebar({ title, actions }); }, [setTitlebar, title, actions, enabled]);
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
function DesktopTitlebar({ immersive, application }: { immersive: boolean; application: WindowTitlebar | null }) {
  const c = useThemeColors();
  const dragRef = useDesktopWindowDragRegion();
  const actionRef = useDesktopWindowDragRegion(false);
  const height = application ? desktopChrome.applicationTitlebarHeight : TITLEBAR_HEIGHT;
  const title = application?.title ?? 'PsstPsst';
  useLayoutEffect(() => {
    if (DESKTOP_OS === 'darwin') return;
    const node = actionRef.current as unknown as HTMLElement | null;
    // Electron exposes the usable title-bar rectangle in CSS pixels, including zoom.
    node?.style.setProperty('right', `calc(100vw - env(titlebar-area-x, 0px) - env(titlebar-area-width, calc(100vw - ${desktopChrome.nativeControlsWidth}px)) + ${spacing.sm}px)`);
  }, [actionRef]);
  useEffect(() => { void platform.windowChrome.setTitle(title).catch(() => {}); }, [title]);

  // Keep the OS-painted frame parts (window background, Windows/Linux caption
  // overlay) on the effective theme, including Settings → Appearance overrides.
  useEffect(() => {
    void platform.windowChrome.setTheme({
      backgroundColor: c.background,
      titlebarColor: c.surfaceMuted,
      symbolColor: c.text,
      transparentTitlebar: immersive,
      titlebarHeight: height,
    });
  }, [c.background, c.surfaceMuted, c.text, immersive, height]);

  return (
    <View
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
        <AppText variant="caption" numberOfLines={1} align="center" style={{ userSelect: 'none', maxWidth: '100%',
          marginHorizontal: application ? desktopChrome.nativeControlsWidth + uiDensity.headerActionSize + spacing.lg : desktopChrome.nativeControlsWidth }}>
          {title}
        </AppText>
      )}
      <View ref={actionRef} style={{ position: 'absolute', top: 0, bottom: 0,
        // Native caption controls retain their physical OS position in RTL layouts.
        right: DESKTOP_OS === 'darwin' ? spacing.sm : desktopChrome.nativeControlsWidth,
        justifyContent: 'center' }}>
        {application?.actions}
      </View>
    </View>
  );
}

/**
 * Root frame for the Electron window: mounts normal title-bar chrome above the
 * app, or overlays it for a focused immersive route. Other runtimes render
 * children untouched.
 */
export function DesktopWindowFrame({ children }: { children: ReactNode }) {
  const c = useThemeColors();
  const [immersive, setImmersive] = useState(false);
  const [titlebar, setTitlebar] = useState<WindowTitlebar | null>(null);
  if (!IS_ELECTRON) return <>{children}</>;
  return (
    <ImmersiveTitlebarContext.Provider value={setImmersive}>
    <WindowTitlebarContext.Provider value={setTitlebar}>
      <View style={{ flex: 1, backgroundColor: c.background }}>
        <DesktopTitlebar immersive={immersive} application={titlebar} />
        <View style={{ flex: 1 }}>{children}</View>
      </View>
    </WindowTitlebarContext.Provider>
    </ImmersiveTitlebarContext.Provider>
  );
}
