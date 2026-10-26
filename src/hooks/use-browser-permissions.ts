import { useEffect, useState } from 'react';
import { readBrowserPermissions, type BrowserPermissionRule } from '@/services/explore/browser-permission-store';
import { subscribeSigning } from '@/services/signing/changes';

/** Only the focused permissions panel subscribes; reads are bounded to one source. */
export function useBrowserPermissions(accountPubkey: string | null, sourceId: string) {
  const [revision, setRevision] = useState(0);
  const [value, setValue] = useState<{ key: string; rules?: BrowserPermissionRule[]; error?: boolean }>();
  const key = JSON.stringify([accountPubkey, sourceId, revision]);
  useEffect(() => {
    if (!accountPubkey) return;
    return subscribeSigning({ accountPubkey, sourceId }, change => {
      if (change.key === undefined || change.key.startsWith('browser:')) setRevision(value => value + 1);
    });
  }, [accountPubkey, sourceId]);
  useEffect(() => {
    let active = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    if (accountPubkey) void readBrowserPermissions({ accountPubkey, sourceId }).then(rules => {
      if (!active) return;
      setValue({ key, rules });
      const expiries = rules.flatMap(rule => rule.expiresAt !== null ? [rule.expiresAt] : []);
      if (expiries.length) timer = setTimeout(() => setRevision(value => value + 1), Math.max(0, Math.min(2147483647, Math.min(...expiries) - Date.now())));
    }).catch(() => { if (active) setValue({ key, error: true }); });
    return () => { active = false; clearTimeout(timer); };
  }, [key, accountPubkey, sourceId]);
  return value?.key === key ? value : undefined;
}
