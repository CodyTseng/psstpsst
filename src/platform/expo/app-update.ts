import type { AppUpdatePort } from '../ports/app-update';

/** Mobile releases are updated by their app-store clients, not by PsstPsst. */
export const appUpdateAdapter: AppUpdatePort = {
  check: () => Promise.reject(new Error('Application updates are unavailable')),
  getStatus: () => Promise.resolve({ state: 'idle' }),
  download: () => Promise.resolve(),
  install: () => Promise.resolve(),
  addStatusListener: () => () => {},
};
