import { platform } from '@/platform';
import { applicationSourceId } from '@/lib/application-identity';
import { getData, setData } from '@/services/napplet/repository';
import type { ExploreEntry } from './model';

type Application = Pick<ExploreEntry, 'kind' | 'address'>;
const scope = (entry: Application, accountPubkey: string) => ({ accountPubkey, appKey: applicationSourceId(entry.address) });

export function defaultApplicationWindowPreference(entry: Application): boolean {
  return entry.kind === 'napp' || entry.kind === 'napplet';
}

/** Website presentation choices are account-scoped and separate from grants. */
export async function readApplicationWindowPreference(entry: Application, account: string): Promise<boolean> {
  if (defaultApplicationWindowPreference(entry)) return true;
  const value = await getData(scope(entry, account), 'host', 'open-in-window');
  return value === 'true' ? true : value === 'false' ? false : defaultApplicationWindowPreference(entry);
}

export async function setApplicationWindowPreference(entry: Application, account: string, enabled: boolean): Promise<void> {
  if (defaultApplicationWindowPreference(entry)) return;
  return setData(scope(entry, account), 'host', 'open-in-window', String(enabled));
}

/** Read on launch so other Electron hosts see changes without a stale preference cache. */
export async function shouldOpenApplicationWindow(entry: Application, account: string): Promise<boolean> {
  if (!platform.napplet.windows && !platform.napplet.tasks) return false;
  return readApplicationWindowPreference(entry, account);
}
