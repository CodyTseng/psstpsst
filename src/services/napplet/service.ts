import { registerNappletLifecycle } from './lifecycle';
import { createStore } from 'zustand/vanilla';
import { getAccount } from '@/services/account/account-access';
import { nappletInstallations, nappletData, nappletUsage } from '@/db/schema';
import { db } from '@/db/client';
import { eq } from 'drizzle-orm';
import { matchFilters } from 'nostr-tools/filter';
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
import { encodeSigningRules, readSigningSnapshot, replaceSigningRule, type SigningRuleTarget, type SigningRuleChange } from './signing-permissions';

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
  runId: number;
  launch: { release: NappletRelease; pending: boolean; showLoading: boolean; error: string | null } | null;
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
  runId: 0,
  launch: null,
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
const addressReaders = new Set<NappletNetwork>();
const signingEdits = new Map<string, Promise<void>>();
let runtime: NappletRuntime | null = null;
const approvals = new PromptQueue((prompt) => nappletStore.setState({ prompt, ...(prompt ? { overlayActive: true } : {}) }));
let theme: RuntimeTheme | null = null;
let until: number | undefined;
let opening = 0;
let navigatingBack: NappletRuntime | null = null;
let runSerial = 0;

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
    for (const reader of addressReaders) reader.destroy();
    addressReaders.clear();
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
  async resolve(value: string, options: { refresh?: boolean } = {}): Promise<NappletRelease> {
    const { accountPubkey: account, installed, market } = nappletStore.getState();
    const epoch = generation;
    if (!catalog || !account) throw new Error('account-unavailable');
    const address = parseAppAddress(value);
    if (!options.refresh) {
      let cached: NappletRelease | undefined;
      for (const releases of [installed, market]) {
        for (const release of releases) {
          if (matchFilters(address.filters, release.event) && (!cached ||
            release.event.created_at > cached.event.created_at ||
            (release.event.created_at === cached.event.created_at && release.event.id < cached.event.id))) cached = release;
        }
      }
      if (cached) return cached;
    }
    const network = new NappletNetwork(account);
    addressReaders.add(network);
    try {
      const filters = address.filters.map((filter) => ({ ...filter, limit: 1 }));
      const initial = [...new Set([...address.relays, ...MARKET_RELAYS])].slice(0, 8);
      let invalid = false;
      let failed = false;
      const lookup = async (relays: string[]) => {
        let result: Awaited<ReturnType<NappletNetwork['query']>>;
        try { result = await network.query(relays, filters); }
        catch { check(account, epoch); failed = true; return null; }
        check(account, epoch);
        failed ||= !!result.error || result.incomplete;
        for (const event of result.events.sort((a, b) => b.created_at - a.created_at || a.id.localeCompare(b.id))) {
          try {
            const release = parseManifest(event);
            nappletStore.setState((state) => {
              const previous = state.market.find((app) => app.key === release.key);
              if (previous && (previous.event.created_at > event.created_at ||
                (previous.event.created_at === event.created_at && previous.event.id <= event.id))) return state;
              return { market: [release, ...state.market.filter((app) => app.key !== release.key)].slice(0, 500) };
            });
            return release;
          }
          catch { invalid = true; }
        }
        return null;
      };
      const release = await lookup(initial);
      if (release) return release;
      if (!address.relays.length && address.author) {
        let relays: string[] = [];
        try { relays = await network.publisherRelays(address.author); }
        catch { failed = true; }
        check(account, epoch);
        const extra = relays.filter((relay) => !initial.includes(relay));
        if (extra.length) {
          const fallback = await lookup(extra);
          if (fallback) return fallback;
        }
      }
      if (invalid) throw new Error('napplets.invalid_manifest');
      if (failed) throw new Error('napplets.request_failed');
      throw new Error('napplets.not_found');
    } finally {
      if (addressReaders.delete(network)) network.destroy();
    }
  },
  async install(release: NappletRelease, expectedAccount?: string, onDownload?: () => void) {
    const account = nappletStore.getState().accountPubkey;
    const epoch = generation;
    if (!account) throw new Error('account-unavailable');
    if (expectedAccount !== undefined && account !== expectedAccount)
      throw new Error('session-closed');
    if (release.required.some((domain) => !(NAP_DOMAINS as readonly string[]).includes(domain)))
      throw new Error('napplets.unsupported');
    await loadArtifact(release, undefined, onDownload);
    check(account, epoch);
    await saveInstallation(account, release);
    check(account, epoch);
    await refresh(account, epoch);
  },
  prepareOpen(release: NappletRelease, expectedAccount: string): number {
    check(expectedAccount, generation);
    const state = nappletStore.getState();
    if (state.launch?.pending && state.launch.release.key === release.key && state.launch.release.hash === release.hash) return state.runId;
    this.stop();
    const runId = ++runSerial;
    nappletStore.setState({ runId, launching: true, launch: { release, pending: true, showLoading: false, error: null } });
    return runId;
  },
  startPreparedOpen(runId: number) {
    const state = nappletStore.getState();
    if (state.runId !== runId || !state.launch?.pending) return;
    nappletStore.setState({ launch: { ...state.launch, pending: false } });
    // The container owns presentation; open records failures in its launch state.
    void this.open(state.launch.release).catch(() => {});
  },
  retryOpen(runId: number) {
    const state = nappletStore.getState();
    if (state.runId !== runId || !state.launch?.error) return;
    nappletStore.setState({ launching: true, launch: { ...state.launch, pending: true, showLoading: false, error: null } });
  },
  async open(release: NappletRelease, delivery?: Record<string, unknown>) {
    const work = this.launch(release, delivery);
    const token = opening;
    try {
      await work;
    } catch (error) {
      if (token === opening) {
        const reason = error instanceof Error ? error.message : 'napplets.request_failed';
        if (reason === 'permission-denied' || reason === 'session-closed') this.stop();
        else {
          approvals.cancelAll();
          nappletStore.setState({ running: null, configuration: null, panel: null, launch: { release, pending: false, showLoading: false, error: reason } });
        }
      }
      throw error;
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
    nappletStore.setState({ launching: true, launch: { release, pending: false, showLoading: false, error: null } });
    const current = () => {
      check(account, epoch);
      if (operation !== opening) throw new Error('session-closed');
    };
    const installed = nappletStore.getState().installed.find((item) => item.key === release.key);
    const downloading = () => {
      current();
      const launch = nappletStore.getState().launch;
      if (launch && !launch.showLoading) nappletStore.setState({ launch: { ...launch, showLoading: true } });
    };
    if (!installed || installed.hash !== release.hash) await this.install(release, account, downloading);
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
    const html = await loadArtifact(release, undefined, downloading);
    current();
    const instance = new NappletRuntime({
      accountPubkey: account,
      release,
      html,
      domains: declared,
      theme: () => theme!,
      presented: () => {
        const launch = nappletStore.getState().launch;
        if (runtime === instance && launch?.showLoading) nappletStore.setState({ launch: { ...launch, showLoading: false } });
      },
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
      if (runtime === instance) runtime = null;
      await instance.close();
      throw error;
    }
  },
  async goBack() {
    const active = runtime;
    const state = nappletStore.getState();
    if (!active || navigatingBack === active || state.sharing || state.overlayActive || state.prompt || state.panel || state.configuration) return;
    navigatingBack = active;
    try {
      const handled = await active.goBack();
      const latest = nappletStore.getState();
      if (runtime === active && !handled && !latest.sharing && !latest.overlayActive && !latest.prompt && !latest.panel && !latest.configuration) this.stop();
    } finally {
      if (navigatingBack === active) navigatingBack = null;
    }
  },
  stop(expectedRunId?: number) {
    if (expectedRunId !== undefined && nappletStore.getState().runId !== expectedRunId) return;
    opening++;
    const old = runtime;
    runtime = null;
    approvals.cancelAll();
    if (old) void old.close().catch(() => {});
    nappletStore.setState({ running: null, launching: false, launch: null, configuration: null, panel: null, overlayActive: false, sharing: false });
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
  async updateSigningRule(release: NappletRelease, source: SigningRuleTarget, change: SigningRuleChange, expectedAccount: string) {
    const epoch = generation;
    check(expectedAccount, epoch);
    const frozen = JSON.parse(JSON.stringify({ source, change })) as { source: SigningRuleTarget; change: SigningRuleChange };
    replaceSigningRule([], frozen.source, frozen.change);
    const scope = { accountPubkey: expectedAccount, appKey: release.key, artifactHash: release.hash };
    const key = JSON.stringify(scope);
    const work = (signingEdits.get(key) ?? Promise.resolve()).catch(() => {}).then(async () => {
      check(expectedAccount, epoch);
      const active = runtime;
      if (active?.scope?.accountPubkey === expectedAccount && active.scope.appKey === release.key && active.scope.artifactHash === release.hash) {
        await active.signingPermissions.edit(frozen.source, frozen.change);
        check(expectedAccount, epoch);
        return;
      }
      if (frozen.change.decision !== 'ask' && frozen.change.duration === 'session') throw new Error('invalid-signing-permissions');
      const saved = await readSigningSnapshot(scope);
      check(expectedAccount, epoch);
      await setData(scope, 'permissions', 'signing', encodeSigningRules(replaceSigningRule(saved.rules, frozen.source, frozen.change)));
      check(expectedAccount, epoch);
      permissionsChanged();
    });
    signingEdits.set(key, work);
    try { await work; }
    finally { if (signingEdits.get(key) === work) signingEdits.delete(key); }
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
