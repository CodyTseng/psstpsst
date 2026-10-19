import { createContext, useContext, useSyncExternalStore } from 'react';
import { platform } from '@/platform';

export const ApplicationTaskContext = createContext<string | null>(null);
const main = () => null;
const subscribeMain = () => () => {};

/** Only the foreground Activity presents the process-wide serialized approval queue. */
export function useOwnsApplicationTaskOverlays() {
  const id = useContext(ApplicationTaskContext);
  const tasks = platform.napplet.tasks;
  const active = useSyncExternalStore(tasks?.onActive ?? subscribeMain, tasks?.active ?? main, main);
  return active === id;
}
