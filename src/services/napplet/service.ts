import { cacheApplicationEvent, readApplicationCache } from '@/services/explore/application-cache';
import { refreshApplicationMetadata } from '@/services/explore/application-metadata';
import { parseFavoriteReference } from '@/services/explore/favorites-protocol';
import { fromNapplet } from '@/services/explore/model';
import { readApplicationHandlers } from '@/services/explore/application-handlers';
import { clearBrowserPermissions, clearAccountBrowserPermissions } from '@/services/explore/browser-permission-store';
import { clearAccountSigningPermissions, clearSigningPermissions, deleteSigningRule, saveSigningRule } from '@/services/signing/repository';
import { desktopApps, moveDesktopApp } from './desktop-order';
import { registerNappletLifecycle, notifyNappletTheme, invalidateNappletSource } from './lifecycle';
import { createStore } from 'zustand/vanilla';
import { getAccount } from '@/services/account/account-access';
import { nappletInstallations, nappletData, nappletUsage, nappletDataLegacy, signingActivity } from '@/db/schema';
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
  saveDesktopOrder,
  clearRecent,
  installations,
  markRecent,
  saveInstallation,
  setData,
} from './repository';
import { NappletRuntime, type RuntimePrompt, type RuntimeTheme } from './runtime';
import type { ConfigSchema } from './config';
import { assertNotAborted } from '@/platform/abort';
import { PromptQueue, type QueuedPrompt } from './prompt-queue';
import { readDomainPermissions, resolveDomainPermissions } from './domain-permissions';
import { platform } from '@/platform';
import { appSigningScope, readSigningSnapshot, replaceSigningRule, type SigningRuleTarget, type SigningRuleChange } from './signing-permissions';

type State = {
  accountPubkey: string | null;
  loaded: boolean;
  recent: NappletInstallation[];
  installed: NappletInstallation[];
  market: NappletRelease[];
  launching: boolean;
  runId: number;
  launch: { release: NappletRelease; reviewedRequired?: readonly string[]; pending: boolean; showLoading: boolean; error: string | null } | null;
  running: { release: NappletRelease; containerId: string } | null;
  prompt: QueuedPrompt | null;
  approvalClosing: boolean;
  overlayActive: boolean;
  sharing: boolean;
  panel: { page: 'about' | 'settings'; release: NappletRelease } | null;
  configuration: { schema: ConfigSchema; values: Record<string, unknown>; requestId?: number } | null;
};
export const nappletStore = createStore<State>(() => ({
  accountPubkey: null,
  loaded: false,
  recent: [],
  installed: [],
  market: [],
  launching: false,
  runId: 0,
  launch: null,
  running: null,
  prompt: null,
  approvalClosing: false,
  configuration: null,
  panel: null,
  overlayActive: false,
  sharing: false,
}));

export const nappletPermissionStore = createStore(() => ({ revision: 0 }));

let generation = 0;
let activation: { account: string; ready: Promise<void>; promise: Promise<void> } | undefined;
let desktopRevision = 0;
let desktopEdits: Promise<void> = Promise.resolve();
let catalog: NappletNetwork | null = null;
const addressReaders = new Set<NappletNetwork>();
const signingEdits = new Map<string, Promise<void>>();
let runtime: NappletRuntime | null = null;
let runtimeClosing: Promise<void> = Promise.resolve();
const approvals = new PromptQueue((prompt, approvalClosing) => nappletStore.setState({ prompt, approvalClosing, ...(prompt ? { overlayActive: true } : {}) }));
let theme: RuntimeTheme | null = null;
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
async function authorizeRelease(release: NappletRelease, account: string, current: () => void, reviewedRequired?: readonly string[]) {
  const scope = { accountPubkey: account, appKey: release.key };
  const required = [...new Set(['shell', ...release.required])];
  const optional = [...new Set(release.optional.filter((domain) =>
    (NAP_DOMAINS as readonly string[]).includes(domain) && !required.includes(domain)))];
  const { saved, denied, domains } = await readDomainPermissions(scope, release);
  current();
  let declared = domains;
  if (!saved || required.some((domain) => !declared.includes(domain))) {
    // Details-page consent applies only to the exact required set the user reviewed.
    const reviewed = reviewedRequired && reviewedRequired.length === required.length
      && required.every((domain) => reviewedRequired.includes(domain));
    const answer = reviewed ? `domains:${JSON.stringify(declared.filter((domain) => optional.includes(domain)))}`
      : await prompt({
        title: release.title, app: release, accountPubkey: account, detail: '',
        capabilities: { required, optional },
      });
    if (!answer) throw new Error('permission-denied');
    current();
    const selected: unknown = answer.startsWith('domains:') ? JSON.parse(answer.slice(8)) : [];
    if (!Array.isArray(selected)) throw new Error('permission-denied');
    declared = resolveDomainPermissions(release, [...required, ...optional.filter((domain) => selected.includes(domain))], denied);
    await setData(scope, 'permissions', 'domains', JSON.stringify(declared));
    current();
    permissionsChanged();
  }
  return declared;
}

async function refresh(account: string, epoch: number) {
  await desktopEdits;
  check(account, epoch);
  const revision = desktopRevision;
  const [recent, installed] = await Promise.all([
    installations(account, true),
    installations(account),
  ]);
  check(account, epoch);
  if (revision !== desktopRevision) return refresh(account, epoch);
  nappletStore.setState({ recent, installed, loaded: true });
}
let externalConfiguration: { save(values: Record<string, unknown>): Promise<void>; signal: AbortSignal; close(): void } | undefined;
let configurationSerial = 0;

export const nappletService = {
  requestApproval: prompt,
  configureExternal(schema: ConfigSchema, values: Record<string, unknown>, save: (values: Record<string, unknown>) => Promise<void>, signal: AbortSignal) {
    assertNotAborted(signal);
    this.closeConfiguration();
    const close = () => { if (externalConfiguration?.signal === signal) this.closeConfiguration(); };
    externalConfiguration = { save, signal, close };
    signal.addEventListener('abort', close, { once: true });
    nappletStore.setState({ configuration: { schema, values, requestId: ++configurationSerial }, overlayActive: true });
  },
  async activate(accountPubkey: string) {
    if (nappletStore.getState().accountPubkey === accountPubkey && nappletStore.getState().loaded) return;
    if (activation?.account === accountPubkey) return activation.promise;
    this.deactivate();
    const epoch = generation;
    let ready!: () => void, failed!: (error: unknown) => void;
    const context = new Promise<void>((resolve, reject) => { ready = resolve; failed = reject; });
    void context.catch(() => {});
    const promise = (async () => {
      if (!(await getAccount(accountPubkey))) throw new Error('account-unavailable');
      if (generation !== epoch) { ready(); return; }
      catalog = new NappletNetwork(accountPubkey);
      nappletStore.setState({ accountPubkey });
      ready();
      await refresh(accountPubkey, epoch);
    })().catch(error => { failed(error); throw error; }).finally(() => { if (activation?.promise === promise) activation = undefined; });
    activation = { account: accountPubkey, ready: context, promise };
    return promise;
  },
  async activateAccount(accountPubkey: string) {
    const work = this.activate(accountPubkey);
    void work.catch(() => {});
    await (activation?.account === accountPubkey ? activation.ready : work);
    if (nappletStore.getState().accountPubkey !== accountPubkey) throw new Error('session-closed');
  },
  deactivate() {
    activation = undefined;
    generation++;
    opening++;
    approvals.cancelAll();
    this.stop();
    for (const reader of addressReaders) reader.destroy();
    addressReaders.clear();
    catalog?.destroy();
    catalog = null;
    nappletStore.setState({
      accountPubkey: null,
      loaded: false,
      recent: [],
      installed: [],
      market: [],
      configuration: null,
    });
  },
  answer(requestId: string, value: string | false) {
    approvals.answer(requestId, value);
  },
  rejectAllRequests() { approvals.rejectAll(); },
  currentTheme() { return theme; },
  updateTheme(value: RuntimeTheme) {
    theme = value;
    runtime?.updateTheme();
    notifyNappletTheme();
  },
  async resolve(value: string, options: { refresh?: boolean } = {}): Promise<NappletRelease> {
    const { accountPubkey: account, installed, market } = nappletStore.getState();
    const epoch = generation;
    if (!catalog || !account) throw new Error('account-unavailable');
    const address = parseAppAddress(value);
    const filter = address.filters[0];
    const reference = filter.ids?.[0] ? parseFavoriteReference(['e', filter.ids[0], address.relays[0] ?? '', address.author ?? '']).entry
      : parseFavoriteReference(['a', `${filter.kinds![0]}:${filter.authors![0]}:${filter['#d']?.[0] ?? ''}`, ...(address.relays[0] ? [address.relays[0]] : [])]).entry;
    if (!options.refresh) {
      const stored = await readApplicationCache([reference]).catch(() => new Map());
      const release = stored.get(reference.key)?.release;
      if (release) {
        void refreshApplicationMetadata(account, [fromNapplet(release)], new AbortController().signal).catch(() => {});
        return release;
      }
      let cached: NappletRelease | undefined;
      for (const releases of [installed, market]) {
        for (const release of releases) {
          if (matchFilters(address.filters, release.event) && (!cached ||
            release.event.created_at > cached.event.created_at ||
            (release.event.created_at === cached.event.created_at && release.event.id < cached.event.id))) cached = release;
        }
      }
      if (cached) {
        await cacheApplicationEvent(fromNapplet(cached)).catch(() => {});
        if (filter.ids?.length) return cached;
        const latest = (await readApplicationCache([fromNapplet(cached)]).catch(() => new Map())).get(fromNapplet(cached).key)?.release;
        return latest ?? cached;
      }
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
            const release = { ...parseManifest(event), eventRelays: result.eventRelays?.get(event.id) ?? [] };
            await cacheApplicationEvent(fromNapplet(release)).catch(() => {});
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
    desktopRevision++;
    await saveInstallation(account, release);
    check(account, epoch);
    await refresh(account, epoch);
  },
  prepareOpen(release: NappletRelease, expectedAccount: string, reviewedRequired?: readonly string[]): number {
    check(expectedAccount, generation);
    const state = nappletStore.getState();
    if (state.launch?.pending && state.launch.release.key === release.key && state.launch.release.hash === release.hash) return state.runId;
    this.stop();
    const runId = ++runSerial;
    nappletStore.setState({ runId, launching: true, launch: { release, reviewedRequired: reviewedRequired ? [...reviewedRequired] : undefined, pending: true, showLoading: false, error: null } });
    return runId;
  },
  async restartOpen(runId: number, release: NappletRelease) {
    const state = nappletStore.getState(), previous = state.running?.release ?? state.launch?.release;
    if (state.runId !== runId || !previous || previous.key !== release.key) throw new Error('session-closed');
    if (!state.accountPubkey) throw new Error('account-unavailable');
    this.stop(runId);
    const cleanup = runtimeClosing, token = opening;
    nappletStore.setState({ launching: true, launch: { release, pending: false, showLoading: true, error: null } });
    try {
      await cleanup;
      const active = nappletStore.getState();
      if (active.runId !== runId || active.accountPubkey !== state.accountPubkey || opening !== token) throw new Error('session-closed');
      nappletStore.setState({ launch: { release, pending: true, showLoading: true, error: null } });
    } catch (error) {
      if (opening === token && nappletStore.getState().runId === runId) nappletStore.setState({ launching: false,
        launch: { release, pending: false, showLoading: false, error: 'napplets.request_failed' } });
      throw error;
    }
  },
  startPreparedOpen(runId: number) {
    const state = nappletStore.getState();
    if (state.runId !== runId || !state.launch?.pending) return;
    nappletStore.setState({ launch: { ...state.launch, pending: false } });
    // The container owns presentation; open records failures in its launch state.
    void this.open(state.launch.release, undefined, state.launch.reviewedRequired).catch(() => {});
  },
  retryOpen(runId: number) {
    const state = nappletStore.getState();
    if (state.runId !== runId || !state.launch?.error) return;
    nappletStore.setState({ launching: true, launch: { ...state.launch, pending: true, showLoading: false, error: null } });
  },
  async open(release: NappletRelease, delivery?: Record<string, unknown>, reviewedRequired?: readonly string[]) {
    const work = this.launch(release, delivery, reviewedRequired);
    const token = opening;
    try {
      await work;
    } catch (error) {
      if (token === opening) {
        const reason = error instanceof Error ? error.message : 'napplets.request_failed';
        if (reason === 'permission-denied' || reason === 'session-closed') this.stop();
        else {
          approvals.cancelAll();
          nappletStore.setState({ running: null, configuration: null, panel: null, launch: { release, reviewedRequired, pending: false, showLoading: false, error: reason } });
        }
      }
      throw error;
    } finally {
      if (token === opening) nappletStore.setState({ launching: false });
    }
  },
  async launch(release: NappletRelease, delivery?: Record<string, unknown>, reviewedRequired?: readonly string[]) {
    const account = nappletStore.getState().accountPubkey;
    const epoch = generation;
    if (!account || !theme) throw new Error('account-unavailable');
    check(account, epoch);
    this.stop();
    const operation = ++opening;
    nappletStore.setState({ launching: true, launch: { release, reviewedRequired: reviewedRequired ? [...reviewedRequired] : undefined, pending: false, showLoading: false, error: null } });
    const current = () => {
      check(account, epoch);
      if (operation !== opening) throw new Error('session-closed');
    };
    if (!nappletStore.getState().loaded) await this.activate(account);
    current();
    const installed = nappletStore.getState().installed.find((item) => item.key === release.key);
    const downloading = () => {
      current();
      const launch = nappletStore.getState().launch;
      if (launch && !launch.showLoading) nappletStore.setState({ launch: { ...launch, showLoading: true } });
    };
    if (!installed || installed.hash !== release.hash) await this.install(release, account, downloading);
    current();
    const declared = await authorizeRelease(release, account, current, reviewedRequired);
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
        const apps = await readApplicationHandlers(account, 'napplet');
        current();
        return apps.flatMap(app => app.release ? [app.release] : []);
      },
      invoke: async (target, payload) => {
        current();
        await this.open(target, payload);
      },
      openBrowser: async url => {
        if (platform.napplet.windows || platform.napplet.tasks) {
          const [{ tryOpenApplicationWindow }, { websiteEntry }, { openInlineApplication }] = await Promise.all([
            import('../explore/windows'), import('../explore/model'), import('../explore/inline-launch')]);
          const entry = websiteEntry(url);
          if (!await tryOpenApplicationWindow(entry, account)) { current(); await openInlineApplication({ entry, account }); }
        } else if (!await platform.urlOpener.openExternalUrl(url)) throw new Error('external-open-failed');
      },
    });
    runtime = instance;
    if (delivery) instance.setDelivery(delivery);
    try {
      const containerId = await instance.open();
      current();
      await markRecent(account, release.key, release);
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
    if (old) runtimeClosing = old.close();
    void runtimeClosing.catch(() => {});
    nappletStore.setState({ running: null, launching: false, launch: null, configuration: null, panel: null, overlayActive: false, sharing: false });
    if (old) permissionsChanged();
  },
  async removeRecent(appKey: string, expectedAccount: string) {
    const epoch = generation;
    check(expectedAccount, epoch);
    const state = nappletStore.getState();
    if (!state.loaded || !state.installed.some((app) => app.key === appKey)) throw new Error('app-not-installed');
    const revision = ++desktopRevision;
    nappletStore.setState({
      installed: state.installed.map((app) => app.key === appKey ? { ...app, lastUsedAt: null } : app),
      recent: state.recent.filter((app) => app.key !== appKey),
    });
    const write = desktopEdits.then(async () => {
      check(expectedAccount, epoch);
      await clearRecent(expectedAccount, appKey);
      check(expectedAccount, epoch);
    });
    desktopEdits = write.catch(() => {});
    try { await write; }
    catch (error) {
      if (generation === epoch && revision === desktopRevision) await refresh(expectedAccount, epoch);
      throw error;
    }
  },
  async moveDesktop(appKey: string, index: number | null, expectedAccount: string) {
    const epoch = generation;
    check(expectedAccount, epoch);
    const state = nappletStore.getState();
    if (!state.loaded || !state.installed.some((app) => app.key === appKey)) throw new Error('app-not-installed');
    const keys = moveDesktopApp(desktopApps(state.installed).map((app) => app.key), appKey, index);
    const positions = new Map(keys.map((key, position) => [key, position]));
    const apply = (app: NappletInstallation) => {
      const desktopPosition = positions.get(app.key) ?? null;
      return desktopPosition === app.desktopPosition ? app : { ...app, desktopPosition };
    };
    const revision = ++desktopRevision;
    nappletStore.setState({ installed: state.installed.map(apply), recent: state.recent.map(apply) });
    const write = desktopEdits.then(async () => {
      check(expectedAccount, epoch);
      await saveDesktopOrder(expectedAccount, keys);
      check(expectedAccount, epoch);
    });
    desktopEdits = write.catch(() => {});
    try { await write; }
    catch (error) {
      if (generation === epoch && revision === desktopRevision) await refresh(expectedAccount, epoch);
      throw error;
    }
  },
  async signingPermissions(release: NappletRelease, expectedAccount: string) {
    const epoch = generation;
    check(expectedAccount, epoch);
    const active = runtime;
    const result = active?.scope?.accountPubkey === expectedAccount && active.scope.appKey === release.key
      ? await active.signingPermissions.snapshot()
      : await readSigningSnapshot({ accountPubkey: expectedAccount, appKey: release.key })
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
    approvals.dismissed();
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
    const { domains } = await readDomainPermissions({ accountPubkey: expectedAccount, appKey: release.key }, release);
    check(expectedAccount, epoch);
    return domains;
  },
  async setDomainPermissions(release: NappletRelease, domains: string[], expectedAccount: string) {
    const epoch = generation;
    check(expectedAccount, epoch);
    const allowed = new Set([...release.required, ...release.optional, 'shell']);
    if (domains.some((domain) => !allowed.has(domain))) throw new Error('invalid-permissions');
    const required = ['shell', ...release.required];
    if (required.some((domain) => !domains.includes(domain))) throw new Error('required-permission');
    const scope = { accountPubkey: expectedAccount, appKey: release.key };
    const { domains: previous, denied } = await readDomainPermissions(scope, release);
    check(expectedAccount, epoch);
    const nextDenied = [...new Set([...denied, ...release.optional.filter(domain => previous.includes(domain) && !domains.includes(domain))])]
      .filter(domain => !domains.includes(domain));
    invalidateNappletSource(expectedAccount, release.key);
    await setData(scope, 'permissions', 'denied-domains', JSON.stringify(nextDenied));
    check(expectedAccount, epoch);
    await setData(scope, 'permissions', 'domains', JSON.stringify([...new Set(domains)]));
    check(expectedAccount, epoch);
    permissionsChanged();
    const state = nappletStore.getState();
    if (state.running?.release.key === release.key) {
      const work = this.open(state.running.release);
      nappletStore.setState({ panel: state.panel, overlayActive: !!state.panel });
      await work;
    }
  },
  async revokeSigningRule(release: NappletRelease, key: string, expectedAccount: string) {
    const epoch = generation;
    check(expectedAccount, epoch);
    const active = runtime;
    if (active?.scope?.accountPubkey === expectedAccount && active.scope.appKey === release.key) {
      await active.signingPermissions.revoke(key);
      check(expectedAccount, epoch);
      return;
    }
    const scope = { accountPubkey: expectedAccount, appKey: release.key };
    await deleteSigningRule(appSigningScope(scope), key);
    check(expectedAccount, epoch);
    permissionsChanged();
  },
  async updateSigningRule(release: NappletRelease, source: SigningRuleTarget, change: SigningRuleChange, expectedAccount: string) {
    const epoch = generation;
    check(expectedAccount, epoch);
    const frozen = JSON.parse(JSON.stringify({ source, change })) as { source: SigningRuleTarget; change: SigningRuleChange };
    replaceSigningRule([], frozen.source, frozen.change);
    const scope = { accountPubkey: expectedAccount, appKey: release.key };
    const key = JSON.stringify(scope);
    const work = (signingEdits.get(key) ?? Promise.resolve()).catch(() => {}).then(async () => {
      check(expectedAccount, epoch);
      const active = runtime;
      if (active?.scope?.accountPubkey === expectedAccount && active.scope.appKey === release.key) {
        await active.signingPermissions.edit(frozen.source, frozen.change);
        check(expectedAccount, epoch);
        return;
      }
      if (frozen.change.decision !== 'ask' && frozen.change.duration === 'session') throw new Error('invalid-signing-permissions');
      const saved = await readSigningSnapshot(scope);
      check(expectedAccount, epoch);
      const next = replaceSigningRule(saved.rules, frozen.source, frozen.change);
      const rule = next.find((entry) => entry.key === frozen.source.key);
      if (rule) await saveSigningRule(appSigningScope(scope), rule);
      else await deleteSigningRule(appSigningScope(scope), frozen.source.key);
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
    invalidateNappletSource(account, release.key);
    const active = runtime?.scope.appKey === release.key ? runtime : null;
    if (active) this.stop();
    await active?.signingPermissions.settled();
    check(account, epoch);
    const scope = { accountPubkey: account, appKey: release.key };
    await setData(scope, 'permissions', 'domains', null);
    check(account, epoch);
    await setData(scope, 'permissions', 'denied-domains', null);
    check(account, epoch);
    await clearSigningPermissions(appSigningScope(scope));
    await clearBrowserPermissions(appSigningScope(scope));
    check(account, epoch);
    permissionsChanged();
  },
  async saveConfiguration(values: Record<string, unknown>) {
    if (externalConfiguration) {
      const owner = externalConfiguration;
      assertNotAborted(owner.signal);
      await owner.save(values);
      if (externalConfiguration === owner) this.closeConfiguration();
      return;
    }
    if (!runtime) throw new Error('session-closed');
    await runtime.saveConfig(values);
    nappletStore.setState({ configuration: null });
  },
  closeConfiguration() {
    if (externalConfiguration) {
      externalConfiguration.signal.removeEventListener('abort', externalConfiguration.close);
      externalConfiguration = undefined;
    }
    nappletStore.setState({ configuration: null });
  },
  async removeAccount(account: string) {
    if (nappletStore.getState().accountPubkey === account) this.deactivate();
    await clearAccountSigningPermissions(account);
    await clearAccountBrowserPermissions(account);
    await db.delete(nappletDataLegacy).where(eq(nappletDataLegacy.accountPubkey, account));
    await db.delete(signingActivity).where(eq(signingActivity.accountPubkey, account));
    await db.delete(nappletData).where(eq(nappletData.accountPubkey, account));
    await db.delete(nappletUsage).where(eq(nappletUsage.accountPubkey, account));
    await db.delete(nappletInstallations).where(eq(nappletInstallations.accountPubkey, account));
  },
};

registerNappletLifecycle((account) => {
  if (!account || nappletStore.getState().accountPubkey === account) nappletService.deactivate();
});
