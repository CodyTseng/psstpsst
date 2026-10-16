import { useCallback, useEffect, useState } from 'react';
import { nappletService } from '@/services/napplet/service';
import type { NappletRelease } from '@/services/napplet/protocol';
import { useNapplets } from '@/stores/napplet.store';

/** Share account-bound listing resolution between app information and permissions. */
export function useNappletRelease(id: string) {
  const state = useNapplets();
  const key = JSON.stringify([state.accountPubkey, id]);
  const [result, setResult] = useState<{ key: string; release?: NappletRelease; error?: string }>();
  const current = result?.key === key ? result : undefined;
  const release = current?.release ?? state.market.find((app) => app.event.id === id) ??
    state.installed.find((app) => app.event.id === id);
  const installed = release ? state.installed.find((app) => app.key === release.key) : undefined;
  useEffect(() => {
    let active = true;
    if (!release && id && state.loaded) void nappletService.resolve(id)
      .then((release) => { if (active) setResult({ key, release }); })
      .catch((error: Error) => {
        if (active) setResult({ key, error: error.message.startsWith('napplets.') ? error.message : 'napplets.request_failed' });
      });
    return () => { active = false; };
  }, [id, key, release, state.loaded]);
  const setRelease = useCallback((release: NappletRelease) => setResult({ key, release }), [key]);
  return { release, installed, accountPubkey: state.accountPubkey, error: current?.error, setRelease };
}
