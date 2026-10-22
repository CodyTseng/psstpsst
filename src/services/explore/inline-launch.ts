import { platform } from '@/platform';
import type { ExploreEntry } from './model';

export type InlineApplicationLaunch = { entry: ExploreEntry; account: string };
type LaunchListener = (launch: InlineApplicationLaunch) => void | Promise<void>;
const listeners = new Set<LaunchListener>();

export function subscribeInlineApplicationLaunch(listener: LaunchListener) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/** Android tasks return navigation to the main router; Electron uses its current host router. */
export async function openInlineApplication(launch: InlineApplicationLaunch): Promise<void> {
  if (platform.napplet.tasks?.active()) await platform.napplet.tasks.showHost();
  const listener = [...listeners].at(-1);
  if (!listener) throw new Error('application-host-unavailable');
  await listener(launch);
}
