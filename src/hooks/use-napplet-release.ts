import { useCallback, useEffect, useState } from 'react';
import { nappletService } from '@/services/napplet/service';
import type { NappletRelease } from '@/services/napplet/protocol';
import { useNapplets } from '@/stores/napplet.store';
import { useActiveAccount } from '@/stores/active-account.store';

/** Share account-bound listing resolution between app information and permissions. */
export function useNappletRelease(id: string) {
  const state = useNapplets();
  const account = useActiveAccount(state => state.activePubkey);
  const [activationError, setActivationError] = useState<{ account: string; message: string }>();
  useEffect(() => {
    if (!account || state.accountPubkey === account && state.loaded) return;
    let active = true;
    void nappletService.activate(account).then(() => {
      if (active) setActivationError(undefined);
    }).catch(() => {
      if (active) setActivationError({ account, message: 'applications.request_failed' });
    });
    return () => { active = false; };
  }, [account, state.accountPubkey, state.loaded]);
  const ready = state.accountPubkey === account;
  const key = JSON.stringify([account, id]);
  const [result, setResult] = useState<{ key: string; release?: NappletRelease; error?: string }>();
  const current = result?.key === key ? result : undefined;
  const release = current?.release ?? (ready ? state.market.find((app) => app.event.id === id) ??
    state.installed.find((app) => app.event.id === id) : undefined);
  const installed = release ? state.installed.find((app) => app.key === release.key) : undefined;
  useEffect(() => {
    let active = true;
    if (!release && id && ready && state.loaded) void nappletService.resolve(id)
      .then((release) => { if (active) setResult({ key, release }); })
      .catch((error: Error) => {
        if (active) setResult({ key, error: error.message.startsWith('applications.') ? error.message : 'applications.request_failed' });
      });
    return () => { active = false; };
  }, [id, key, release, ready, state.loaded]);
  const setRelease = useCallback((release: NappletRelease) => setResult({ key, release }), [key]);
  return { release, installed, accountPubkey: ready ? account : null,
    error: current?.error ?? (activationError?.account === account ? activationError.message : undefined), setRelease };
}
