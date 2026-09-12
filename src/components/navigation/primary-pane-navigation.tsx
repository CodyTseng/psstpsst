import { router, useGlobalSearchParams, usePathname } from 'expo-router';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { useWindowDimensions } from 'react-native';

import { PRIMARY_PANE_RESET_MARKER } from '@/components/navigation/responsive-stack-router';
import { isWideLayoutSize } from '@/lib/layout/wide-layout';
import {
  pathnameFromHref,
  shouldResetPrimaryPaneDetail,
} from '@/lib/layout/primary-pane-navigation';
import {
  getWidePaneSelection,
  type WidePaneSelection,
} from '@/lib/layout/wide-pane-selection';

type PrimaryPaneNavigation = {
  open: (href: string) => void;
  pendingPathname: string | null;
  selection: WidePaneSelection;
  wide: boolean;
};

const PrimaryPaneNavigationContext = createContext<PrimaryPaneNavigation | null>(null);

const NO_WIDE_PANE_SELECTION: WidePaneSelection = {
  conversationKey: null,
  profilePubkey: null,
  settingsItem: null,
};

const compactPrimaryPaneNavigation: PrimaryPaneNavigation = {
  open: (href) => router.push(href),
  pendingPathname: null,
  selection: NO_WIDE_PANE_SELECTION,
  wide: false,
};

/** Owns navigation dispatched by the persistent pane. A first detail is pushed;
 * later primary selections atomically rebuild the detail stack while compact
 * navigation keeps the ordinary stack behavior. */
export function PrimaryPaneNavigationProvider({ children }: { children: ReactNode }) {
  const { width, height } = useWindowDimensions();
  const wide = isWideLayoutSize(width, height);

  if (!wide) {
    return (
      <PrimaryPaneNavigationContext.Provider value={compactPrimaryPaneNavigation}>
        {children}
      </PrimaryPaneNavigationContext.Provider>
    );
  }

  return <WidePrimaryPaneNavigationProvider>{children}</WidePrimaryPaneNavigationProvider>;
}

/**
 * Own the global URL subscriptions only while the primary pane is persistent.
 * A compact stack keeps its underlying tab route mounted during a push; keeping
 * these subscriptions out of that branch prevents a pathname change from
 * synchronously re-rendering the hidden inbox before the native transition can
 * start.
 */
function WidePrimaryPaneNavigationProvider({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const { chat } = useGlobalSearchParams<{ chat?: string | string[] }>();
  const pathnameRef = useRef(pathname);
  const pendingRef = useRef<string | null>(null);
  const [pendingPathname, setPendingPathname] = useState<string | null>(null);

  useEffect(() => {
    pathnameRef.current = pathname;
  }, [pathname]);

  const clearPending = useCallback(() => {
    pendingRef.current = null;
    setPendingPathname(null);
  }, []);

  useEffect(() => {
    if (pendingPathname == null || pathname !== pendingPathname) return;
    const frame = requestAnimationFrame(clearPending);
    return () => cancelAnimationFrame(frame);
  }, [clearPending, pathname, pendingPathname]);

  const profileOpenedFromChat =
    pendingPathname == null && (Array.isArray(chat) ? chat.includes('1') : chat === '1');
  const selection = useMemo(
    () => getWidePaneSelection(pendingPathname ?? pathname, profileOpenedFromChat),
    [pathname, pendingPathname, profileOpenedFromChat],
  );

  const open = useCallback((href: string) => {
    const nextPathname = pathnameFromHref(href);
    // Do not deduplicate by pathname here: query/fragment state can select a
    // different message inside the same conversation, or clear an existing
    // focus. The responsive stack compares the complete route params and still
    // makes exact repeated pushes idempotent at action time.
    const resetDetail = shouldResetPrimaryPaneDetail(
      true,
      pathnameRef.current,
      pendingRef.current,
    );

    pendingRef.current = nextPathname;
    setPendingPathname(nextPathname);

    if (resetDetail) {
      // The responsive stack consumes this action-only marker and produces
      // [primary, destination] in one state calculation. No empty pane commits.
      router.push(href, { dangerouslySingular: PRIMARY_PANE_RESET_MARKER });
    } else {
      router.push(href);
    }
  }, []);

  const value = useMemo(
    () => ({ open, pendingPathname, selection, wide: true }),
    [open, pendingPathname, selection],
  );

  return (
    <PrimaryPaneNavigationContext.Provider value={value}>
      {children}
    </PrimaryPaneNavigationContext.Provider>
  );
}

export function usePrimaryPaneNavigation(): PrimaryPaneNavigation {
  const value = useContext(PrimaryPaneNavigationContext);
  if (value == null) {
    throw new Error('usePrimaryPaneNavigation must be used inside PrimaryPaneNavigationProvider');
  }
  return value;
}
