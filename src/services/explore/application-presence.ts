import { createStore } from 'zustand/vanilla';
import { platform } from '@/platform';
import { applicationInstanceKey } from '@/lib/application-identity';
import type { RunningApplication } from '@/platform/ports/application-window';

export const applicationPresenceStore = createStore(() => ({ running: new Set<string>() }));
export const applicationPresence = {
  set(account: string, sourceId: string, running: boolean) {
    const key = applicationInstanceKey(account, sourceId);
    applicationPresenceStore.setState(state => {
      if (state.running.has(key) === running) return state;
      const next = new Set(state.running); if (running) next.add(key); else next.delete(key);
      return { running: next };
    });
  },
  observeWindows() {
    const windows = platform.napplet.windows;
    if (!windows?.running || !windows.onRunningChange) return () => {};
    let active = true, revision = 0;
    const replace = (applications: RunningApplication[]) => {
      const running = new Set(applications.map(app => applicationInstanceKey(app.accountPubkey, app.sourceId)));
      applicationPresenceStore.setState(state => state.running.size === running.size && [...running].every(key => state.running.has(key)) ? state : { running });
    };
    const stop = windows.onRunningChange(applications => { revision++; if (active) replace(applications); });
    const initial = revision;
    void windows.running().then(applications => { if (active && initial === revision) replace(applications); })
      .catch(error => console.warn('[explore] Running windows could not load', error));
    return () => { active = false; stop(); };
  },
};
