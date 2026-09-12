import type { AppUpdatePort } from '../ports/app-update';

/** Mobile releases are updated by their app-store clients, not by PsstPsst. */
export const appUpdateAdapter: AppUpdatePort = {
  getStatus: () => Promise.resolve({ state: 'idle' }),
  download: () => Promise.resolve(),
  install: () => Promise.resolve(),
  addStatusListener: () => () => {},
};
