import { nappletAccessDomains } from '@/services/napplet/access-domains';
import { useEffect, useState } from 'react';
import type { NappletRelease } from '@/services/napplet/protocol';
import { nappletService } from '@/services/napplet/service';
import { useNappletPermissionRevision } from '@/stores/napplet.store';

/** Read consent for the exact account and artifact shown on the details page. */
export function useNappletAccess(release: NappletRelease | undefined, accountPubkey: string | null) {
  const revision = useNappletPermissionRevision();
  const key = JSON.stringify([accountPubkey, release?.eventKey, release?.hash, release?.required, revision]);
  const [result, setResult] = useState<{ key: string; approved?: boolean; error?: string }>();
  useEffect(() => {
    let active = true;
    if (release && accountPubkey) void nappletService.activateAccount(accountPubkey)
      .then(() => active ? nappletService.domainPermissions(release, accountPubkey) : undefined)
      .then((domains) => {
        if (active && domains) setResult({ key, approved: ['shell', ...nappletAccessDomains(release.required)].every((domain) => domains.includes(domain)) });
      }).catch(() => { if (active) setResult({ key, error: 'applications.request_failed' }); });
    return () => { active = false; };
  }, [release, accountPubkey, key]);
  const current = result?.key === key ? result : undefined;
  return { loaded: current?.approved !== undefined, approved: current?.approved === true, error: current?.error };
}
