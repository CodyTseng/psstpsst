import { useEffect } from 'react';
import { pushOnce } from '@/lib/navigation';
import { subscribeInlineApplicationLaunch } from '@/services/explore/inline-launch';
import { exploreService } from '@/services/explore/service';
import { useActiveAccount } from '@/stores/active-account.store';

export function useInlineApplicationLaunch() {
  useEffect(() => {
    let mounted = true;
    const unsubscribe = subscribeInlineApplicationLaunch(async ({ entry, account }) => {
      const current = () => {
        const active = useActiveAccount.getState();
        if (!mounted || active.status !== 'ready' || active.activePubkey !== account) throw new Error('session-closed');
      };
      current();
      await exploreService.activate(account);
      current();
      const runId = exploreService.prepare(entry, account);
      pushOnce({ pathname: '/explore-run', params: { runId } });
    });
    return () => { mounted = false; unsubscribe(); };
  }, []);
}
