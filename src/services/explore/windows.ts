import { platform } from '@/platform';
import { canReceiveForAccount } from '@/services/account/account-receive-guard';
import { registerNappletLifecycle } from '@/services/napplet/lifecycle';
import { parseManifest, publicUrl } from '@/services/napplet/protocol';
import { fromNapplet, parseSite, websiteAddress, type ExploreEntry } from './model';
import type { ApplicationWindowLaunch } from '@/platform/ports/application-window';

export async function openApplicationWindow(entry: ExploreEntry, accountPubkey: string, reviewedRequired?: readonly string[]) {
  if (!platform.napplet.windows) throw new Error('napplets.rebuild_required');
  if (!await canReceiveForAccount(accountPubkey)) throw new Error('account-unavailable');
  await platform.napplet.windows.open({ accountPubkey, address: entry.address, manifest: entry.manifest, servers: entry.servers, reviewedRequired: reviewedRequired ? [...reviewedRequired] : undefined });
}

/** Re-verify launch data; the runtime validates reviewed requirements against the manifest. */
export async function readApplicationWindowLaunch(): Promise<{ entry: ExploreEntry; accountPubkey: string; reviewedRequired?: readonly string[] }> {
  const launch: ApplicationWindowLaunch | null | undefined = await platform.napplet.windows?.launch();
  if (!launch || !await canReceiveForAccount(launch.accountPubkey)) throw new Error('account-unavailable');
  let entry: ExploreEntry;
  if (launch.manifest) entry = [5129, 15129, 35129].includes(launch.manifest.kind) ? fromNapplet(parseManifest(launch.manifest)) : parseSite(launch.manifest);
  else {
    const address = websiteAddress(launch.address);
    entry = { key: address, address, title: new URL(address).host, kind: 'website', description: '', servers: [], required: [], desktopPosition: null, lastUsedAt: null };
  }
  if (!entry.servers.length && launch.servers) {
    entry = { ...entry, servers: [...new Set(launch.servers.slice(0, 8).map(server => publicUrl(server)))] };
    if (entry.release) entry.release = { ...entry.release, servers: entry.servers };
  }
  const reviewedRequired = Array.isArray(launch.reviewedRequired) && launch.reviewedRequired.every(domain => typeof domain === 'string')
    ? launch.reviewedRequired : undefined;
  return { entry, accountPubkey: launch.accountPubkey, reviewedRequired };
}

registerNappletLifecycle(account => {
  const windows = platform.napplet.windows;
  if (windows && !windows.isHost) void windows.closeAll(account).catch(() => {});
});
