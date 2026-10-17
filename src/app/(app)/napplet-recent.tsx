import { useNappletShare } from '@/hooks/use-napplet-share';
import { useEffect, useMemo, useState } from 'react';
import { router } from 'expo-router';
import { NappletRecentPage } from '@/components/napplet/NappletRecentPage';
import { recentApps } from '@/services/napplet/desktop-order';
import type { NappletInstallation } from '@/services/napplet/protocol';
import { nappletService } from '@/services/napplet/service';
import { useActiveAccount } from '@/stores/active-account.store';
import { useNapplets } from '@/stores/napplet.store';

export default function NappletRecentScreen() {
  const account = useActiveAccount((state) => state.activePubkey);
  return <AccountRecent key={account ?? 'signed-out'} account={account} />;
}

function AccountRecent({ account }: { account: string | null }) {
  const state = useNapplets();
  const share = useNappletShare(account);
  const [error, setError] = useState<string | null>(null);
  const recent = useMemo(() => recentApps(state.installed), [state.installed]);
  const desktopCount = useMemo(() => state.installed.reduce((count, app) => count + Number(app.desktopPosition !== null), 0), [state.installed]);
  useEffect(() => {
    if (account) void nappletService.activate(account).catch(() => setError('napplets.request_failed'));
  }, [account]);
  function open(app: NappletInstallation) {
    setError(null);
    try {
      const runId = nappletService.prepareOpen(app, account ?? '');
      router.push(`/napplet-run?runId=${runId}`);
    } catch {
      setError('napplets.request_failed');
    }
  }
  function add(app: NappletInstallation) {
    if (app.desktopPosition !== null) return;
    setError(null);
    void nappletService.moveDesktop(app.key, desktopCount, account ?? '')
      .catch(() => setError('napplets.request_failed'));
  }
  return <NappletRecentPage recent={recent} error={error}
    loaded={state.loaded && state.accountPubkey === account} onOpen={open} onAdd={add}
    onPermissions={(app) => router.push(`/napplet-permissions/${app.event.id}`)} onShare={share}
    onDetails={(app) => router.push(`/napplet/${app.event.id}`)}
    onRemove={(app) => { void nappletService.removeRecent(app.key, account ?? '').catch(() => setError('napplets.request_failed')); }} />;
}
