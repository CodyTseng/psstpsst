import { useEffect, useState } from 'react';
import { nappletService } from '@/services/napplet/service';
import type { NappletRelease } from '@/services/napplet/protocol';
import type { SigningSnapshot } from '@/services/napplet/signing-permissions';
import { useNappletAccountPubkey, useNappletPermissionRevision } from '@/stores/napplet.store';
import { useIsFocused } from 'expo-router/react-navigation';

export function useNappletPermissions(release: NappletRelease, enabled = true) {
  const accountPubkey = useNappletAccountPubkey();
  const permissionsRevision = useNappletPermissionRevision();
  const focused = useIsFocused();
  const [expiryTick, setExpiryTick] = useState(0);
  const [value, setValue] = useState<{ key: string; data?: SigningSnapshot; error?: boolean }>();
  const key = JSON.stringify([accountPubkey, release.key, release.hash, permissionsRevision, focused, enabled, expiryTick]);
  useEffect(() => {
    let active = true;
    if (accountPubkey && focused && enabled) void nappletService.signingPermissions(release, accountPubkey)
      .then((data) => { if (active) setValue({ key, data }); })
      .catch(() => { if (active) setValue({ key, error: true }); });
    return () => { active = false; };
  }, [accountPubkey, release, key, focused, enabled]);
  useEffect(() => {
    if (!focused || !enabled || value?.key !== key) return;
    const expiries = value.data?.rules.flatMap((rule) => rule.duration === 'timed' && rule.expiresAt ? [rule.expiresAt] : []) ?? [];
    if (!expiries.length) return;
    const timer = setTimeout(() => setExpiryTick((tick) => tick + 1), Math.max(0, Math.min(...expiries) - Date.now()));
    return () => clearTimeout(timer);
  }, [value, key, focused, enabled]);
  return { data: value?.key === key ? value.data : undefined, error: value?.key === key && value.error, accountPubkey };
}
