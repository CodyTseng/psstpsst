import { db } from '@/db/client';
import { getData, setData, type AppScope } from './repository';
import { parseDomainPermissions } from './domain-permissions';

export type DomainPermissionChange = { domain: string; enabled: boolean };

/** Apply only explicit edits, atomically, without materializing a level's effective access. */
export async function saveDomainPermissionChanges(scope: AppScope, changes: readonly DomainPermissionChange[], current: () => void) {
  if (!changes.length) return;
  await db.transaction(async tx => {
    current();
    const granted = new Set(parseDomainPermissions(await getData(scope, 'permissions', 'domains', tx)));
    const denied = new Set(parseDomainPermissions(await getData(scope, 'permissions', 'denied-domains', tx)));
    for (const { domain, enabled } of changes) {
      if (enabled) { granted.add(domain); denied.delete(domain); }
      else { granted.delete(domain); denied.add(domain); }
    }
    await setData(scope, 'permissions', 'domains', JSON.stringify([...granted]), tx);
    await setData(scope, 'permissions', 'denied-domains', JSON.stringify([...denied]), tx);
    current();
  });
}
