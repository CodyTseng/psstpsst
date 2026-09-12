import { useFocusEffect } from 'expo-router';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { View } from 'react-native';

import { AppText } from '@/components/common/AppText';
import { IS_ELECTRON } from '@/lib/platform';
import { platform } from '@/platform';
import { desktopChrome, useThemeColors } from '@/theme';

const TITLEBAR_HEIGHT = desktopChrome.titlebarHeight;
const ImmersiveTitlebarContext = createContext<(enabled: boolean) => void>(() => {});

/** Marks a non-interactive Electron surface as a native window drag region. */
export function useDesktopWindowDragRegion() {
  const dragRef = useRef<View>(null);

  useEffect(() => {
    if (!IS_ELECTRON) return;

    // `-webkit-app-region: drag` has no React Native style equivalent; apply it
    // to the host node directly.
    const node = dragRef.current as unknown as HTMLElement | null;
    node?.style.setProperty('-webkit-app-region', 'drag');
    return () => {
      node?.style.removeProperty('-webkit-app-region');
    };
  }, []);

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
function DesktopTitlebar({ immersive }: { immersive: boolean }) {
  const c = useThemeColors();
  const dragRef = useDesktopWindowDragRegion();

  // Keep the OS-painted frame parts (window background, Windows/Linux caption
  // overlay) on the effective theme, including Settings → Appearance overrides.
  useEffect(() => {
    void platform.windowChrome.setTheme({
      backgroundColor: c.background,
      titlebarColor: c.surfaceMuted,
      symbolColor: c.text,
      transparentTitlebar: immersive,
    });
  }, [c.background, c.surfaceMuted, c.text, immersive]);

  return (
    <View
      ref={dragRef}
      style={{
        height: TITLEBAR_HEIGHT,
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
        <AppText variant="caption" style={{ userSelect: 'none' }}>
          PsstPsst
        </AppText>
      )}
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
  if (!IS_ELECTRON) return <>{children}</>;
  return (
    <ImmersiveTitlebarContext.Provider value={setImmersive}>
      <View style={{ flex: 1, backgroundColor: c.background }}>
        <DesktopTitlebar immersive={immersive} />
        <View style={{ flex: 1 }}>{children}</View>
      </View>
    </ImmersiveTitlebarContext.Provider>
  );
}
