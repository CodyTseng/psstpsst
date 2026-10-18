import { platform } from '@/platform';
import { canReceiveForAccount } from '@/services/account/account-receive-guard';
import { registerNappletLifecycle } from '@/services/napplet/lifecycle';
import { parseManifest, publicUrl } from '@/services/napplet/protocol';
import { fromNapplet, parseSite, websiteAddress, type ExploreEntry } from './model';
import type { ApplicationWindowLaunch } from '@/platform/ports/application-window';

export async function openApplicationWindow(entry: ExploreEntry, accountPubkey: string) {
  if (!platform.napplet.windows) throw new Error('napplets.rebuild_required');
  if (!await canReceiveForAccount(accountPubkey)) throw new Error('account-unavailable');
  await platform.napplet.windows.open({ accountPubkey, address: entry.address, manifest: entry.manifest, servers: entry.servers });
}

export async function openApplicationWindowForKey(key: string) {
  const [{ exploreStore }, { discoveryStore }, { nappletStore }] = await Promise.all([
    import('./service'), import('./discovery'), import('@/services/napplet/service'),
  ]);
  const state = exploreStore.getState(), napplet = nappletStore.getState();
  const entry = state.entries.find(entry => entry.key === key) ?? (state.entry?.key === key ? state.entry : undefined) ?? discoveryStore.getState().entries.find(entry => entry.key === key);
  const release = napplet.running?.release.key === key ? napplet.running.release : [...napplet.installed, ...napplet.market].find(release => release.key === key);
  const account = state.account ?? napplet.accountPubkey;
  if (!account || !entry && !release) throw new Error('account-unavailable');
  await openApplicationWindow(entry ?? fromNapplet(release!), account);
}

/** Re-verify the launch data in the new host; no renderer-supplied grant is accepted. */
export async function readApplicationWindowLaunch(): Promise<{ entry: ExploreEntry; accountPubkey: string }> {
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
  return { entry, accountPubkey: launch.accountPubkey };
}

registerNappletLifecycle(account => {
  const windows = platform.napplet.windows;
  if (windows && !windows.isHost) void windows.closeAll(account).catch(() => {});
});
