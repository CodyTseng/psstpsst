const PRIMARY_PANE_PATHNAMES = new Set(['/', '/contacts', '/me']);

/** Whether the globally active URL belongs to the persistent tab pane itself. */
export function isPrimaryPanePathname(pathname: string): boolean {
  return PRIMARY_PANE_PATHNAMES.has(pathname);
}

/** A primary-pane destination resets the current detail stack only in wide mode. */
export function shouldResetPrimaryPaneDetail(
  wide: boolean,
  currentPathname: string,
  pendingPathname: string | null,
): boolean {
  return wide && (pendingPathname != null || !isPrimaryPanePathname(currentPathname));
}

/** Strip URL-only state so a pending href can bridge pathname propagation. */
export function pathnameFromHref(href: string): string {
  const queryIndex = href.search(/[?#]/);
  const pathname = queryIndex === -1 ? href : href.slice(0, queryIndex);
  try {
    // Expo's live pathname is decoded, while an href built for router.push may
    // still contain encoded dynamic segments. Normalize the pending path so a
    // wide-pane row stays selected during and after navigation.
    return pathname
      .split('/')
      .map((segment) => decodeURIComponent(segment))
      .join('/');
  } catch {
    return pathname;
  }
}
