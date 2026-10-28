import type { NappletInstallation } from './protocol';

/** Desktop order is explicit and independent of launch timestamps. */
export function desktopApps(installed: readonly NappletInstallation[]): NappletInstallation[] {
  return installed.filter((app) => app.desktopPosition !== null)
    .sort((a, b) => a.desktopPosition! - b.desktopPosition! || a.eventKey.localeCompare(b.eventKey));
}

export function moveDesktopApp(keys: readonly string[], key: string, index: number | null): string[] {
  const next = keys.filter((entry) => entry !== key);
  if (index !== null) {
    if (!Number.isSafeInteger(index)) throw new Error('invalid-desktop-position');
    next.splice(Math.max(0, Math.min(index, next.length)), 0, key);
  }
  return next;
}

/** The full history uses already-loaded account installations, not only the preview window. */
export function recentApps(installed: readonly NappletInstallation[]): NappletInstallation[] {
  return installed.filter((app) => app.lastUsedAt !== null)
    .sort((a, b) => b.lastUsedAt! - a.lastUsedAt! || a.eventKey.localeCompare(b.eventKey));
}
