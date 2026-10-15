import { registerNappletLifecycle } from './lifecycle';
import { createStore } from 'zustand/vanilla';
import { getAccount } from '@/services/account/account-access';
import { nappletInstallations, nappletData, nappletUsage } from '@/db/schema';
import { db } from '@/db/client';
import { and, eq } from 'drizzle-orm';
import { loadArtifact } from './artifacts';
import { NappletNetwork } from './network';
import {
  MARKET_RELAYS,
  NAP_DOMAINS,
  parseAppAddress,
  parseManifest,
  type NappletInstallation,
  type NappletRelease,
} from './protocol';
import {
  changeRecent,
  getData,
  installations,
  markRecent,
  migrateStorage,
  saveInstallation,
  setData,
} from './repository';
import { NappletRuntime, type RuntimePrompt, type RuntimeTheme } from './runtime';
import type { ConfigSchema } from './config';
import { PromptQueue, type QueuedPrompt } from './prompt-queue';
import { encodeSigningRules, readSigningSnapshot } from './signing-permissions';

type State = {
  accountPubkey: string | null;
  loaded: boolean;
  loading: boolean;
  error: string | null;
  recent: NappletInstallation[];
  installed: NappletInstallation[];
  market: NappletRelease[];
  hasMore: boolean;
  launching: boolean;
  running: { release: NappletRelease; containerId: string } | null;
  prompt: QueuedPrompt | null;
  overlayActive: boolean;
  sharing: boolean;
  panel: { page: 'about' | 'settings'; release: NappletRelease } | null;
  configuration: { schema: ConfigSchema; values: Record<string, unknown> } | null;
};
export const nappletStore = createStore<State>(() => ({
  accountPubkey: null,
  loaded: false,
  loading: false,
  error: null,
  recent: [],
  installed: [],
  market: [],
  hasMore: true,
  launching: false,
  running: null,
  prompt: null,
  configuration: null,
  panel: null,
  overlayActive: false,
  sharing: false,
}));

export const nappletPermissionStore = createStore(() => ({ revision: 0 }));

let generation = 0;
let catalog: NappletNetwork | null = null;
let runtime: NappletRuntime | null = null;
const approvals = new PromptQueue((prompt) => nappletStore.setState({ prompt, ...(prompt ? { overlayActive: true } : {}) }));
let theme: RuntimeTheme | null = null;
let until: number | undefined;
let opening = 0;

function check(account: string, epoch: number) {
  if (generation !== epoch || nappletStore.getState().accountPubkey !== account)
    throw new Error('session-closed');
}
function prompt(value: RuntimePrompt, signal?: AbortSignal): Promise<string | false> {
  return approvals.ask(value, signal);
}
function permissionsChanged() {
  nappletPermissionStore.setState((state) => ({ revision: state.revision + 1 }));
}
async function refresh(account: string, epoch: number) {
  const [recent, installed] = await Promise.all([
    installations(account, true),
    installations(account),
  ]);
  check(account, epoch);
  nappletStore.setState({ recent, installed, loaded: true });
}
export const nappletService = {
  async activate(accountPubkey: string) {
    if (nappletStore.getState().accountPubkey === accountPubkey) return;
    this.deactivate();
    const epoch = generation;
    if (!(await getAccount(accountPubkey))) throw new Error('account-unavailable');
    if (generation !== epoch) return;
    catalog = new NappletNetwork(accountPubkey);
    nappletStore.setState({ accountPubkey });
    await refresh(accountPubkey, epoch);
  },
  deactivate() {
    generation++;
    opening++;
    approvals.cancelAll();
    this.stop();
    catalog?.destroy();
    catalog = null;
    until = undefined;
    nappletStore.setState({
      accountPubkey: null,
      loaded: false,
      loading: false,
      recent: [],
      installed: [],
      market: [],
      hasMore: true,
      error: null,
      configuration: null,
    });
  },
  answer(requestId: string, value: string | false) {
    approvals.answer(requestId, value);
  },
  rejectAllRequests() { approvals.rejectAll(); },
  updateTheme(value: RuntimeTheme) {
    theme = value;
    runtime?.updateTheme();
  },
  async discover(reset = false) {
    const { accountPubkey, loading, market } = nappletStore.getState();
    if (!accountPubkey || !catalog || loading) return;
    const epoch = generation;
    const network = catalog;
    nappletStore.setState({ loading: true, error: null });
    try {
      const result = await network.query(MARKET_RELAYS, [
        { kinds: [5129, 15129, 35129], limit: 100, ...(reset || !until ? {} : { until }) },
      ]);
      check(accountPubkey, epoch);
      if (result.error && !result.events.length) throw new Error('napplets.request_failed');
      const releases = new Map(
        (reset && !result.incomplete ? [] : market).map((release) => [release.key, release]),
      );
      for (let offset = 0; offset < result.events.length; offset += 4) {
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
        check(accountPubkey, epoch);
        for (const event of result.events.slice(offset, offset + 4)) {
          try {
            const release = parseManifest(event);
            const old = releases.get(release.key);
            if (
              !old ||
              old.event.created_at < event.created_at ||
              (old.event.created_at === event.created_at && old.event.id > event.id)
            )
              releases.set(release.key, release);
          } catch {
            /* Invalid manifests cannot enter the catalog. */
          }
        }
      }
      until = result.events.length
        ? Math.min(...result.events.map((event) => event.created_at)) - 1
        : until;
      nappletStore.setState({
        market: [...releases.values()]
          .sort((a, b) => b.event.created_at - a.event.created_at)
          .slice(0, 500),
        hasMore: result.events.length >= 100,
        error: result.incomplete ? 'napplets.partial_discovery' : null,
      });
    } catch (error) {
      if (generation === epoch)
        nappletStore.setState({
          error: error instanceof Error ? error.message : 'napplets.request_failed',
        });
    } finally {
      if (generation === epoch) nappletStore.setState({ loading: false });
    }
  },
  async resolve(value: string): Promise<NappletRelease> {
    const network = catalog;
    const account = nappletStore.getState().accountPubkey;
    const epoch = generation;
    if (!network || !account) throw new Error('account-unavailable');
    const address = parseAppAddress(value);
    const result = await network.query(
      [...new Set([...address.relays, ...MARKET_RELAYS])].slice(0, 8),
      address.filters,
    );
    check(account, epoch);
    for (const event of result.events.sort((a, b) => b.created_at - a.created_at)) {
      try {
        return parseManifest(event);
      } catch {}
    }
    throw new Error('napplets.not_found');
  },
  async install(release: NappletRelease, expectedAccount?: string) {
    const account = nappletStore.getState().accountPubkey;
    const epoch = generation;
    if (!account) throw new Error('account-unavailable');
    if (expectedAccount !== undefined && account !== expectedAccount)
      throw new Error('session-closed');
    if (release.required.some((domain) => !(NAP_DOMAINS as readonly string[]).includes(domain)))
      throw new Error('napplets.unsupported');
    await loadArtifact(release);
    check(account, epoch);
    await saveInstallation(account, release);
    check(account, epoch);
    await refresh(account, epoch);
  },
  async open(release: NappletRelease, delivery?: Record<string, unknown>) {
    const work = this.launch(release, delivery);
    const token = opening;
    try {
      await work;
    } finally {
      if (token === opening) nappletStore.setState({ launching: false });
    }
  },
  async launch(release: NappletRelease, delivery?: Record<string, unknown>) {
    const account = nappletStore.getState().accountPubkey;
    const epoch = generation;
    if (!account || !theme) throw new Error('account-unavailable');
    this.stop();
    const operation = ++opening;
    nappletStore.setState({ launching: true });
    const current = () => {
      check(account, epoch);
      if (operation !== opening) throw new Error('session-closed');
    };
    const installed = nappletStore.getState().installed.find((item) => item.key === release.key);
    if (!installed || installed.hash !== release.hash) await this.install(release);
    current();
    const scope = { accountPubkey: account, appKey: release.key, artifactHash: release.hash };
    const required = [...new Set(['shell', ...release.required])];
    const optional = [...new Set(release.optional.filter((domain) =>
      (NAP_DOMAINS as readonly string[]).includes(domain) && !required.includes(domain)))];
    const saved = await getData(scope, 'permissions', 'domains');
    current();
    let declared = saved ? (JSON.parse(saved) as string[]).filter((domain) =>
      required.includes(domain) || optional.includes(domain)) : [];
    if (!saved || required.some((domain) => !declared.includes(domain))) {
      const answer = await prompt({
        title: release.title, app: release, accountPubkey: account, detail: '',
        capabilities: { required, optional },
      });
      if (!answer) throw new Error('permission-denied');
      current();
      const selected: unknown = answer.startsWith('domains:') ? JSON.parse(answer.slice(8)) : [];
      if (!Array.isArray(selected)) throw new Error('permission-denied');
      declared = [...required, ...optional.filter((domain) => selected.includes(domain))];
      await setData(scope, 'permissions', 'domains', JSON.stringify(declared));
    }
    const html = await loadArtifact(release);
    current();
    const instance = new NappletRuntime({
      accountPubkey: account,
      release,
      html,
      domains: declared,
      theme: () => theme!,
      confirm: prompt,
      permissionsChanged,
      configure: (schema, values) => {
        if (runtime === instance) nappletStore.setState({ configuration: { schema, values }, overlayActive: true });
      },
      handlers: async () => {
        current();
        return nappletStore.getState().installed;
      },
      invoke: async (target, payload) => {
        current();
        await this.open(target, payload);
      },
    });
    runtime = instance;
    if (delivery) instance.setDelivery(delivery);
    try {
      const containerId = await instance.open();
      current();
      await markRecent(account, release.key);
      current();
      nappletStore.setState({ running: { release, containerId } });
      await refresh(account, epoch);
    } catch (error) {
      if (runtime === instance) this.stop();
      else await instance.close();
      throw error;
    }
  },
  stop() {
    opening++;
    const old = runtime;
    runtime = null;
    approvals.cancelAll();
    if (old) void old.close().catch(() => {});
    nappletStore.setState({ running: null, launching: false, configuration: null, panel: null, overlayActive: false, sharing: false });
    if (old) permissionsChanged();
  },
  async recentAction(appKey: string, action: 'pin' | 'unpin' | 'remove', expectedAccount?: string) {
    const account = nappletStore.getState().accountPubkey;
    const epoch = generation;
    if (!account || (expectedAccount !== undefined && account !== expectedAccount)) return;
    await changeRecent(account, appKey, action);
    await refresh(account, epoch);
  },
  async signingPermissions(release: NappletRelease, expectedAccount: string) {
    const epoch = generation;
    check(expectedAccount, epoch);
    const active = runtime;
    const result = active?.scope?.accountPubkey === expectedAccount && active.scope.appKey === release.key && active.scope.artifactHash === release.hash
      ? await active.signingPermissions.snapshot()
      : await readSigningSnapshot({ accountPubkey: expectedAccount, appKey: release.key, artifactHash: release.hash })
        .then((value) => ({ ...value, activity: value.activity.reverse() }));
    check(expectedAccount, epoch);
    return result;
  },
  startShare(expectedAccount: string, release: NappletRelease) {
    check(expectedAccount, generation);
    const state = nappletStore.getState();
    if (!state.running || state.running.release.key !== release.key || state.running.release.hash !== release.hash || state.prompt || state.configuration || state.panel) throw new Error('session-closed');
    approvals.setPaused(true);
    nappletStore.setState({ sharing: true });
  },
  closeShare(expectedAccount: string, containerId: string) {
    if (nappletStore.getState().accountPubkey !== expectedAccount || nappletStore.getState().running?.containerId !== containerId) return;
    nappletStore.setState({ sharing: false });
    approvals.setPaused(false);
  },
  openPanel(page: 'about' | 'settings') {
    const running = nappletStore.getState().running;
    if (running) nappletStore.setState({ panel: { page, release: running.release }, overlayActive: true });
  },
  overlayClosed() {
    const { prompt, configuration, panel } = nappletStore.getState();
    if (!prompt && !configuration && !panel) nappletStore.setState({ overlayActive: false });
  },
  async reload(release: NappletRelease, expectedAccount: string) {
    check(expectedAccount, generation);
    const running = nappletStore.getState().running;
    if (!running || running.release.key !== release.key || running.release.hash !== release.hash) throw new Error('session-closed');
    await this.open(release);
  },
  closePanel() { nappletStore.setState({ panel: null }); },
  async domainPermissions(release: NappletRelease, expectedAccount: string): Promise<string[]> {
    const epoch = generation;
    check(expectedAccount, epoch);
    const saved = await getData({ accountPubkey: expectedAccount, appKey: release.key, artifactHash: release.hash }, 'permissions', 'domains');
    check(expectedAccount, epoch);
    return saved ? JSON.parse(saved) : [];
  },
  async setDomainPermissions(release: NappletRelease, domains: string[], expectedAccount: string) {
    const epoch = generation;
    check(expectedAccount, epoch);
    const allowed = new Set([...release.required, ...release.optional, 'shell']);
    if (domains.some((domain) => !allowed.has(domain))) throw new Error('invalid-permissions');
    const required = ['shell', ...release.required];
    if (required.some((domain) => !domains.includes(domain))) throw new Error('required-permission');
    await setData({ accountPubkey: expectedAccount, appKey: release.key, artifactHash: release.hash }, 'permissions', 'domains', JSON.stringify([...new Set(domains)]));
    check(expectedAccount, epoch);
    permissionsChanged();
    const state = nappletStore.getState();
    if (state.running?.release.key === release.key && state.running.release.hash === release.hash) {
      const work = this.open(release);
      nappletStore.setState({ panel: state.panel, overlayActive: !!state.panel });
      await work;
    }
  },
  async revokeSigningRule(release: NappletRelease, key: string, expectedAccount: string) {
    const epoch = generation;
    check(expectedAccount, epoch);
    const active = runtime;
    if (active?.scope?.accountPubkey === expectedAccount && active.scope.appKey === release.key && active.scope.artifactHash === release.hash) {
      await active.signingPermissions.revoke(key);
      check(expectedAccount, epoch);
      return;
    }
    const scope = { accountPubkey: expectedAccount, appKey: release.key, artifactHash: release.hash };
    const saved = await readSigningSnapshot(scope);
    check(expectedAccount, epoch);
    await setData(scope, 'permissions', 'signing', encodeSigningRules(saved.rules.filter((rule) => rule.key !== key)));
    check(expectedAccount, epoch);
    permissionsChanged();
  },
  async revoke(release: NappletRelease, expectedAccount?: string) {
    const account = nappletStore.getState().accountPubkey;
    const epoch = generation;
    if (!account || (expectedAccount !== undefined && account !== expectedAccount)) return;
    const active = runtime;
    this.stop();
    await active?.signingPermissions.settled();
    check(account, epoch);
    const scope = { accountPubkey: account, appKey: release.key, artifactHash: release.hash };
    await setData(scope, 'permissions', 'domains', null);
    check(account, epoch);
    await setData(scope, 'permissions', 'signing', null);
    check(account, epoch);
    permissionsChanged();
  },
  async clearDefaults(appKey: string, expectedAccount?: string) {
    const account = nappletStore.getState().accountPubkey;
    if (!account || (expectedAccount !== undefined && account !== expectedAccount)) return;
    const rows = await db
      .select()
      .from(nappletData)
      .where(
        and(
          eq(nappletData.accountPubkey, account),
          eq(nappletData.appKey, 'host:intent-defaults'),
          eq(nappletData.bucket, 'defaults'),
          eq(nappletData.value, appKey),
        ),
      )
      .limit(256);
    for (const row of rows)
      if (
        row.appKey === 'host:intent-defaults' &&
        row.bucket === 'defaults' &&
        row.value === appKey
      ) {
        await setData(
          { accountPubkey: account, appKey: row.appKey, artifactHash: row.artifactHash },
          'defaults',
          row.key,
          null,
        );
      }
  },
  async migrate(release: NappletInstallation, expectedAccount: string) {
    if (nappletStore.getState().accountPubkey !== expectedAccount || !release.previousManifest)
      throw new Error('session-closed');
    this.stop();
    const old = parseManifest(JSON.parse(release.previousManifest));
    const scope = { accountPubkey: expectedAccount, appKey: release.key };
    await migrateStorage(
      { ...scope, artifactHash: old.hash },
      { ...scope, artifactHash: release.hash },
    );
  },
  async rollback(release: NappletInstallation, expectedAccount?: string) {
    if (!release.previousManifest) return;
    await this.install(parseManifest(JSON.parse(release.previousManifest)), expectedAccount);
  },
  async saveConfiguration(values: Record<string, unknown>) {
    if (!runtime) throw new Error('session-closed');
    await runtime.saveConfig(values);
    nappletStore.setState({ configuration: null });
  },
  closeConfiguration() {
    nappletStore.setState({ configuration: null });
  },
  async removeAccount(account: string) {
    if (nappletStore.getState().accountPubkey === account) this.deactivate();
    await db.delete(nappletData).where(eq(nappletData.accountPubkey, account));
    await db.delete(nappletUsage).where(eq(nappletUsage.accountPubkey, account));
    await db.delete(nappletInstallations).where(eq(nappletInstallations.accountPubkey, account));
  },
};

registerNappletLifecycle((account) => {
  if (!account || nappletStore.getState().accountPubkey === account) nappletService.deactivate();
});
