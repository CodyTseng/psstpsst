import { useStore } from 'zustand';
import { applicationPresenceStore } from '@/services/explore/application-presence';
import { applicationInstanceKey } from '@/lib/application-identity';
import { useActiveAccount } from './active-account.store';

export function useApplicationRunning(sourceId?: string) {
  const account = useActiveAccount(state => state.activePubkey);
  const key = account && sourceId ? applicationInstanceKey(account, sourceId) : null;
  return useStore(applicationPresenceStore, state => !!key && state.running.has(key));
}
