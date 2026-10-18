import type { NappletRelease } from './protocol';
/** Account lifecycle must not eagerly load the renderer or application runtime. */
const listeners = new Set<(account?: string) => void>();
export function registerNappletLifecycle(listener: (account?: string) => void) {
  listeners.add(listener);
}
export const nappletLifecycle = {
  deactivate() {
    for (const stop of listeners) stop();
  },
  removing(account: string) {
    for (const stop of listeners) stop(account);
  },
};

const visits = new Set<(account: string, release: NappletRelease) => void>();
export function registerNappletVisit(listener: (account: string, release: NappletRelease) => void) { visits.add(listener); }
export function notifyNappletVisit(account: string, release: NappletRelease) { for (const listener of visits) listener(account, release); }

const themes = new Set<() => void>();
export function registerNappletTheme(listener: () => void) { themes.add(listener); }
export function notifyNappletTheme() { for (const listener of themes) listener(); }
