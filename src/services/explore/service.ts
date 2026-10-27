import { parseApplicationAddressQuery, resolveApplicationAddress } from './address-search';
import { subscribeApplicationMetadata } from './application-metadata';
import { invalidateReplaceableEvents } from '@/services/relay/replaceable-events.service';
import { platform } from '@/platform';
import { needsFavoriteMetadata, resolveFavoriteMetadata } from './favorite-metadata';
import { subscribeFavoritesChanged } from './favorites-events';
import { readApplicationHandlers } from './application-handlers';
import { createStore } from 'zustand/vanilla';
import { nappletService, nappletStore } from '@/services/napplet/service';
import { registerNappletLifecycle, registerNappletVisit, registerNappletTheme, invalidateNappletSource } from '@/services/napplet/lifecycle';
import { moveDesktopApp } from '@/services/napplet/desktop-order';
import { clearBrowserPermissions } from './browser-permission-store';
import { clearSigningPermissions } from '@/services/signing/repository';
import { getData, setData } from '@/services/napplet/repository';
import { readFavoriteEntries, readFavoriteReferences, readFavoriteMetadata, reorder, visit, forget } from './repository';
import { FAVORITES_PAGE_SIZE, fromNapplet, mergeApplicationEntries, applicationPresentation, applicationRequirements, applicationSigningSource, SUPPORTED_NAPP_DOMAINS, websiteAddress, withVisit, websiteEntry, type ExploreEntry } from './model';
import { updateApplicationMetadata, withApplicationMetadata } from './application-event';
import { isNewerEvent } from '@/lib/nostr/event-version';
import { ExploreRuntime } from './runtime';
import { assertNotAborted } from '@/platform/abort';
import { openApplicationWindow, tryOpenApplicationWindow } from './windows';
export const exploreStore = createStore(() => ({ account: null as string | null, loaded: false, favoriteVisibleCount: FAVORITES_PAGE_SIZE, favoritesLoadingMore: false, entries: [] as ExploreEntry[],
  surfaces: [] as string[], runId: 0, entry: null as ExploreEntry | null, containerId: null as string | null, loading: false, error: null as string | null, accessRevision: 0 }));
let epoch = 0, serial = 0, desktopRevision = 0;
let pendingDesktopRevision: number | undefined;
let activation: { account: string; promise: Promise<void> } | undefined;
let runtime: ExploreRuntime | undefined;
let navigatingBack: ExploreRuntime | undefined;
const parents: { runtime: ExploreRuntime; entry: ExploreEntry; containerId: string }[] = [];
let launchLife = new AbortController();
let reviewedAccess: {runId:number;required:readonly string[]}|undefined;
export { SUPPORTED_NAPP_DOMAINS } from './model';
let writes: Promise<unknown> = Promise.resolve();
let favoritesLife = new AbortController();
const metadataLoaded = new Set<string>();
const metadataReads = new Map<string, Promise<void>>();
let moreFavorites: Promise<void> | undefined;
const favoriteHydration = {
  pending: new Map<string, ExploreEntry>(),
  active: new Set<string>(),
  attempted: new Set<string>(),
};

/** Missing cross-device manifests resolve in the background, independently of local pagination. */
function hydrateFavorites(account: string, page: ExploreEntry[], generation: number) {
  const signal = favoritesLife.signal;
  for (const entry of page) {
    if (!needsFavoriteMetadata(entry) || favoriteHydration.attempted.has(entry.key)) continue;
    favoriteHydration.attempted.add(entry.key);
    if (!favoriteHydration.active.has(entry.key)) favoriteHydration.pending.set(entry.key, entry);
  }
  const next = () => {
    if (signal.aborted) return;
    while (favoriteHydration.active.size < 4 && favoriteHydration.pending.size) {
      const [key, entry] = favoriteHydration.pending.entries().next().value!;
      favoriteHydration.pending.delete(key);
      favoriteHydration.active.add(key);
      void resolveFavoriteMetadata(account, entry, signal).then(resolved => {
        check(account, generation);
        applyMetadata([resolved]);
      }).catch(() => {
        // Keep the reference; the next Favorites visit may retry an unavailable manifest.
      }).finally(() => {
        if (signal.aborted) return;
        favoriteHydration.active.delete(key);
        next();
      });
    }
  };
  next();
}
let favoritesRead = 0;
let stopDatabase: (() => void) | undefined;
let databaseTimer: ReturnType<typeof setTimeout> | undefined;
function favoritesInOrder() {
  return exploreStore.getState().entries.filter(entry => entry.desktopPosition !== null)
    .sort((a, b) => a.desktopPosition! - b.desktopPosition!);
}
function applyMetadata(metadata: ExploreEntry[]) {
  if (metadata.length === 1) {
    exploreStore.setState(state => {
      const entries = updateApplicationMetadata(state.entries, metadata[0]);
      return entries === state.entries ? state : { entries };
    });
    return;
  }
  const byKey = new Map(metadata.map(entry => [entry.key, entry]));
  exploreStore.setState(state => {
    const next = state.entries.map(entry => {
      const updated = byKey.get(entry.key);
      if (!updated || entry.manifest && (!updated.manifest || isNewerEvent(entry.manifest, updated.manifest))) return entry;
      return withApplicationMetadata(entry, updated);
    });
    const entries = mergeApplicationEntries(state.entries, next);
    return entries === state.entries ? state : { entries };
  });
}
async function loadMetadata(account: string, page: ExploreEntry[], generation: number) {
  check(account, generation);
  const read = favoritesRead;
  const pending = new Set(page.map(entry => metadataReads.get(entry.key)).filter((work): work is Promise<void> => !!work));
  const missing = page.filter(entry => !metadataReads.has(entry.key));
  if (missing.length) {
    const work = (async () => {
      const metadata = await readFavoriteMetadata(account, missing);
      check(account, generation);
      if (read !== favoritesRead) return;
      for (const entry of missing) metadataLoaded.add(entry.key);
      applyMetadata(metadata);
    })().finally(() => {
      for (const entry of missing) if (metadataReads.get(entry.key) === work) metadataReads.delete(entry.key);
    });
    for (const entry of missing) metadataReads.set(entry.key, work);
    pending.add(work);
  }
  await Promise.all(pending);
}
async function loadMissingMetadata(account: string, entries: ExploreEntry[], generation: number, hydrate = true) {
  const read = favoritesRead;
  const missing = entries.filter(entry => !metadataLoaded.has(entry.key));
  for (let index = 0; index < missing.length; index += FAVORITES_PAGE_SIZE) {
    check(account, generation);
    if (read !== favoritesRead) return;
    await loadMetadata(account, missing.slice(index, index + FAVORITES_PAGE_SIZE).filter(entry => !metadataLoaded.has(entry.key)), generation);
  }
  check(account, generation);
  if (read !== favoritesRead) return;
  if (hydrate) {
    const keys = new Set(entries.map(entry => entry.key));
    const current = new Map(exploreStore.getState().entries.filter(entry => keys.has(entry.key)).map(entry => [entry.key, entry]));
    hydrateFavorites(account, entries.flatMap(entry => {
      const latest = current.get(entry.key);
      return latest ? [latest] : [];
    }), generation);
  }
}
async function refreshFavoriteMembership(account: string, generation: number) {
  const revision = desktopRevision;
  const favorites = await readFavoriteReferences(account);
  check(account, generation);
  if (revision !== desktopRevision) return;
  const previous = exploreStore.getState().entries;
  const saved = new Map(favorites.map(entry => [entry.key, entry]));
  const previousKeys = new Set(previous.map(entry => entry.key));
  for (const entry of favorites) if (!previousKeys.has(entry.key)) metadataLoaded.delete(entry.key);
  const entries = previous.flatMap(entry => {
    const favorite = saved.get(entry.key);
    if (favorite) { saved.delete(entry.key); return [{ ...withApplicationMetadata(favorite, entry), lastUsedAt: entry.lastUsedAt }]; }
    return entry.lastUsedAt !== null ? [{ ...entry, desktopPosition: null }] : [];
  }).concat([...saved.values()]);
  const updated = mergeApplicationEntries(previous, entries);
  if (updated !== previous) exploreStore.setState({ entries: updated });
  await loadMissingMetadata(account, favoritesInOrder().slice(0, exploreStore.getState().favoriteVisibleCount), generation);
}
const check = (account: string, generation: number) => { if (exploreStore.getState().account !== account || epoch !== generation)
  throw new Error('session-closed'); };
export const exploreService = {
  isCurrentRun(account: string, runId: number) {
    const state=exploreStore.getState();
    return state.account===account && state.runId===runId && !!state.entry;
  },
  async activate(account: string, options: { refresh?: boolean } = {}) {
    if (activation?.account === account) return activation.promise;
    const sameAccount = exploreStore.getState().account === account;
    if (sameAccount && exploreStore.getState().loaded && !options.refresh) return;
    if (!sameAccount) this.deactivate();
    const generation = epoch;
    const read = ++favoritesRead;
    moreFavorites = undefined;
    metadataLoaded.clear(); metadataReads.clear();
    // Rebuild queued work for the new page window without losing occupied worker slots.
    favoriteHydration.pending.clear(); favoriteHydration.attempted.clear();
    const promise = (async () => {
      exploreStore.setState({ account });
      const revision = desktopRevision;
      const editing = pendingDesktopRevision !== undefined;
      const favorites = await readFavoriteEntries(account);
      if (generation !== epoch || read !== favoritesRead) return;
      for (const entry of favorites.slice(0, FAVORITES_PAGE_SIZE)) if (entry.kind === 'website' || entry.manifest) metadataLoaded.add(entry.key);
      if (!editing && revision === desktopRevision) {
        exploreStore.setState(state => {
          const previous = new Map(state.entries.map(entry => [entry.key, entry]));
          const entries = favorites.map(entry => {
            const cached = previous.get(entry.key);
            return cached?.manifest && !entry.manifest ? withApplicationMetadata(entry, cached) : entry;
          });
          return { entries: mergeApplicationEntries(state.entries, entries), loaded: true,
            favoriteVisibleCount: FAVORITES_PAGE_SIZE, favoritesLoadingMore: false };
        });
      } else {
        applyMetadata(favorites.slice(0, FAVORITES_PAGE_SIZE));
        exploreStore.setState({ loaded: true, favoritesLoadingMore: false });
      }
      setTimeout(() => {
        if (generation !== epoch || read !== favoritesRead) return;
        void loadMissingMetadata(account, favoritesInOrder().slice(0, FAVORITES_PAGE_SIZE), generation).catch(() => {});
      }, 0);
      stopDatabase?.();
      stopDatabase = platform.database?.addChangeListener?.(event => {
        if (!event.external || event.tableName !== 'private_list_sync_state') return;
        invalidateReplaceableEvents();
        if (databaseTimer) clearTimeout(databaseTimer);
        databaseTimer = setTimeout(() => {
          void (async () => {
            await writes;
            check(account, generation);
            await refreshFavoriteMembership(account, generation);
          })().catch(() => {});
        }, 40);
      });
    })().finally(() => { if (activation?.promise === promise) activation = undefined; });
    activation = { account, promise };
    return promise;
  },
  deactivate() {
    stopDatabase?.(); stopDatabase = undefined;
    if (databaseTimer) clearTimeout(databaseTimer);
    databaseTimer = undefined;
    activation = undefined; moreFavorites = undefined;
    pendingDesktopRevision = undefined;
    favoritesLife.abort(); favoritesLife = new AbortController();
    favoriteHydration.pending.clear(); favoriteHydration.active.clear(); favoriteHydration.attempted.clear();
    metadataLoaded.clear(); metadataReads.clear(); favoritesRead++; epoch++; this.stop();
    exploreStore.setState({ account: null, loaded: false, favoriteVisibleCount: FAVORITES_PAGE_SIZE, favoritesLoadingMore: false, entries: [] });
  },
  loadMoreFavorites(account: string) {
    check(account, epoch);
    if (activation?.account === account) return activation.promise;
    if (moreFavorites) return moreFavorites;
    const state = exploreStore.getState(), entries = favoritesInOrder();
    const count = Math.min(entries.length, state.favoriteVisibleCount + FAVORITES_PAGE_SIZE);
    if (count <= state.favoriteVisibleCount) return Promise.resolve();
    const generation = epoch;
    const read = favoritesRead;
    exploreStore.setState({ favoritesLoadingMore: true });
    const work = loadMissingMetadata(account, entries.slice(state.favoriteVisibleCount, count), generation)
      .then(async () => {
        check(account, generation);
        if (read !== favoritesRead) return;
        await loadMissingMetadata(account, favoritesInOrder().slice(0, count), generation);
        check(account, generation);
        if (read !== favoritesRead) return;
        exploreStore.setState({ favoriteVisibleCount: count });
      })
      .finally(() => { if (moreFavorites === work) {
        moreFavorites = undefined;
        if (epoch === generation) exploreStore.setState({ favoritesLoadingMore: false });
      } });
    moreFavorites = work;
    return work;
  },
  async loadFavoriteSearchMetadata(account: string) {
    check(account, epoch);
    await loadMissingMetadata(account, favoritesInOrder(), epoch, false);
  },
  async resolve(value: string): Promise<ExploreEntry> {
    const { account, entries } = exploreStore.getState();
    if (!account) throw new Error('account-unavailable');
    const generation = epoch, query = parseApplicationAddressQuery(value);
    if (query?.type === 'invalid') throw new Error('napplets.invalid_manifest');
    if (!query) { await nappletService.activateAccount(account); check(account, generation); }
    const resolved = query?.type === 'website' ? websiteEntry(query.key) : query?.type === 'naddr'
      ? await resolveApplicationAddress(account, query, entries, favoritesLife.signal)
      : fromNapplet(await nappletService.resolve(value));
    check(account, generation);
    return resolved;
  },
  remember(app: ExploreEntry, account: string) {
    const generation = epoch;
    check(account, generation);
    const existing = exploreStore.getState().entries.find(e => e.key === app.key);
    const updated = { ...app, desktopPosition: existing ? existing.desktopPosition : app.desktopPosition, lastUsedAt: Date.now() };
    exploreStore.setState(s=>({entries:withVisit(s.entries,updated,updated.lastUsedAt)}));
    const work = writes.then(async () => { check(account, generation); await visit(account, updated); });
    writes = work.catch(() => { });
    return work;
  },
  move(app: ExploreEntry, index: number | null, account: string) {
    const generation = epoch;
    check(account, generation);
    const revision=++desktopRevision;
    pendingDesktopRevision = revision;
    const previous = exploreStore.getState().entries;
    const keys = moveDesktopApp(previous.filter(e => e.desktopPosition !== null).sort((a, b) => a.desktopPosition! - b.desktopPosition!).map(e => e.key), app.key, index);
    const positions = new Map(keys.map((key, i) => [key, i]));
    exploreStore.setState({ entries: (previous.some(e=>e.key===app.key)||index===null?previous:[...previous,{...app,lastUsedAt:null}]).map(e => ({ ...e, desktopPosition: positions.get(e.key) ?? null })) });
    if (!previous.some(entry => entry.key === app.key) && (app.manifest || app.kind === 'website')) metadataLoaded.add(app.key);
    void loadMissingMetadata(account, favoritesInOrder().slice(0, exploreStore.getState().favoriteVisibleCount), generation).catch(() => {});
    const work = writes.then(async () => { check(account, generation); await reorder(account, keys, app); });
    writes = work.catch(() => { });
    return work.catch(async error=>{
      await writes;
      if(epoch===generation && revision===desktopRevision) await refreshFavoriteMembership(account, generation);
      throw error;
    }).finally(() => { if (epoch === generation && pendingDesktopRevision === revision) pendingDesktopRevision = undefined; });
  },
  forget(app: ExploreEntry, account: string) {
    const generation = epoch;
    check(account, generation);
    exploreStore.setState(s => ({ entries: s.entries.map(e => e.key === app.key ? { ...e, lastUsedAt: null } : e) }));
    const work = writes.then(async () => { check(account, generation); await forget(account, app.key); });
    writes = work.catch(() => { });
    return work;
  },
  async resolveFavorite(app: ExploreEntry, account: string) {
    const generation = epoch;
    check(account, generation);
    const resolved = await resolveFavoriteMetadata(account, app, favoritesLife.signal);
    check(account, generation);
    return resolved;
  },
  async access(app: ExploreEntry, account: string) {
    const generation=epoch;
    check(account,generation);
    const stored=await getData({accountPubkey:account,appKey:this.signingSource(app)},'permissions','domains');
    check(account,generation);
    const domains:unknown=stored?JSON.parse(stored):[];
    if(!Array.isArray(domains)||domains.some(domain=>typeof domain!=='string'))throw new Error('invalid-permissions');
    return applicationRequirements(app.kind, app.required).every(domain=>domains.includes(domain));
  },
  prepare(app: ExploreEntry, account: string, reviewedRequired?:readonly string[]) {
    check(account, epoch);
    app = { ...app, required: applicationRequirements(app.kind, app.required) };
    this.stop();
    nappletService.stop();
    launchLife = new AbortController();
    const runId = ++serial;
    reviewedAccess=reviewedRequired?{runId,required:[...reviewedRequired]}:undefined;
    exploreStore.setState({ runId, entry: app, loading: true, error: null });
    return runId;
  },
  start(runId: number) {
    return beginStartup(runId);
  },
  retry(runId:number) {
    const state=exploreStore.getState();
    if(state.runId!==runId || !state.entry || !state.error)return;
    void runtime?.stop();runtime=undefined;
    launchLife.abort();launchLife=new AbortController();
    exploreStore.setState({containerId:null,surfaces:parents.map(parent=>parent.containerId),loading:true,error:null});
  },
  async configure(runId: number) {
    if (exploreStore.getState().runId !== runId || !runtime) throw new Error('session-closed');
    await runtime.openConfiguration();
  },
  reload(runId: number) {
    const state=exploreStore.getState();
    if(state.runId!==runId || !state.entry || !state.containerId)return;
    void runtime?.stop();runtime=undefined;
    launchLife.abort();launchLife=new AbortController();
    exploreStore.setState({containerId:null,surfaces:parents.map(parent=>parent.containerId),loading:true,error:null});
  },
  async restart(runId: number, entry: ExploreEntry) {
    const previous = exploreStore.getState(), old = runtime;
    if (previous.runId !== runId || previous.entry?.key !== entry.key || !old) throw new Error('session-closed');
    entry = { ...entry, required: applicationRequirements(entry.kind, entry.required) };
    launchLife.abort(); launchLife = new AbortController();
    runtime = undefined; reviewedAccess = undefined;
    // Reserve startup before publishing state that can trigger route-driven initialization.
    const start = beginStartup(runId, Promise.resolve(old.stop()));
    exploreStore.setState({ entry, containerId: null, surfaces: parents.map(parent => parent.containerId), loading: true, error: null });
    await start;
    const state = exploreStore.getState();
    if (state.runId === runId && state.error) throw new Error(state.error);
  },
  async openInWindow(runId: number) {
    const state = exploreStore.getState(), instance = runtime;
    if (state.runId !== runId || !state.entry || !state.account || !instance) throw new Error('session-closed');
    await openApplicationWindow(state.entry, state.account);
    // A delayed launch must never close a newer inline runtime.
    if (runtime === instance) this.close(runId);
  },
  close(runId: number) {
    if (exploreStore.getState().runId !== runId) return;
    const parent = parents.pop();
    if (!parent) { this.stop(runId); return; }
    void runtime?.stop(); runtime = parent.runtime;
    exploreStore.setState({ entry: parent.entry, containerId: parent.containerId, surfaces: [...parents.map(frame => frame.containerId), parent.containerId], loading: false, error: null });
  },
  async goBack(runId: number) {
    const active = runtime;
    const overlay = () => { const state = nappletStore.getState(); return state.prompt || state.configuration || state.overlayActive; };
    if (exploreStore.getState().runId !== runId || overlay()) return;
    if (!active) { this.close(runId); return; }
    if (navigatingBack === active) return;
    navigatingBack = active;
    try {
      const handled = await active.goBack();
      if (runtime === active && !handled && !overlay()) this.close(runId);
    } finally { if (navigatingBack === active) navigatingBack = undefined; }
  },
  stop(runId?: number) {
    if (runId !== undefined && runId !== exploreStore.getState().runId)
      return;
    launchLife.abort();
    reviewedAccess=undefined;
    void runtime?.stop();
    runtime = undefined;
    for (const parent of parents.splice(0)) void parent.runtime.stop();
    exploreStore.setState({ containerId: null, surfaces: [], entry: null, loading: false, error: null });
  },
  async reset(app: ExploreEntry, account: string) {
    const generation = epoch;
    check(account, generation);
    const sourceId = this.signingSource(app);
    invalidateNappletSource(account, sourceId);
    const current = exploreStore.getState().entry;
    if (current && this.signingSource(current) === sourceId || parents.some(parent => this.signingSource(parent.entry) === sourceId))
      this.stop();
    await clearSigningPermissions({ accountPubkey: account, sourceId });
    await clearBrowserPermissions({ accountPubkey: account, sourceId });
    check(account, generation);
    await setData({ accountPubkey: account, appKey: sourceId }, 'permissions', 'domains', null);
    check(account, generation);
    await setData({ accountPubkey: account, appKey: sourceId }, 'permissions', 'denied-domains', null);
    check(account,generation);exploreStore.setState(state=>({accessRevision:state.accessRevision+1}));
  },
  signingSource: applicationSigningSource,
};
let starting: { runId: number; signal: AbortSignal; promise: Promise<void> } | undefined;
function beginStartup(runId: number, cleanup?: Promise<void>): Promise<void> {
  const signal = launchLife.signal;
  if (starting?.runId === runId && starting.signal === signal) return starting.promise;
  const promise = launchRuntime(runId, cleanup).finally(() => {
    if (starting?.promise === promise) starting = undefined;
  });
  starting = { runId, signal, promise };
  return promise;
}
async function launchRuntime(runId: number, cleanup?: Promise<void>) {
  const { account } = exploreStore.getState();
  let { entry } = exploreStore.getState();
  if (runtime) return;
  const generation = epoch;
  if (!account || !entry || runId !== exploreStore.getState().runId)
    return;
  const signal=launchLife.signal;
  const current=()=>{check(account,generation);assertNotAborted(signal);if(runId!==exploreStore.getState().runId)throw new Error('session-closed');};
  try {
    if (cleanup) { await cleanup; current(); entry = exploreStore.getState().entry!; }
    if (needsFavoriteMetadata(entry)) {
      entry = await resolveFavoriteMetadata(account, entry, signal);
      current();
      exploreStore.setState({ entry });
    }
    if (entry.kind === 'napp') {
      if (entry.required.some(d => !SUPPORTED_NAPP_DOMAINS.includes(d)))
        throw new Error('napplets.unsupported');
    }
    const scope = { accountPubkey: account, appKey: exploreService.signingSource(entry) };
    const stored = await getData(scope, 'permissions', 'domains');
    current();
    const grants: string[] = stored ? JSON.parse(stored) : [];
    if (entry.required.some(d => !grants.includes(d))) {
      const reviewed=reviewedAccess?.runId===runId && reviewedAccess.required.length===entry.required.length && entry.required.every(domain=>reviewedAccess!.required.includes(domain));
      const answer = reviewed?'allow':await nappletService.requestApproval({ title: entry.title, detail: '', accountPubkey: account, application: applicationPresentation(entry) }, signal);
      current();
      if (runId !== exploreStore.getState().runId || answer !== 'allow')
        throw new Error('permission-denied');
      await setData(scope, 'permissions', 'domains', JSON.stringify(entry.required));
      current();exploreStore.setState(state=>({accessRevision:state.accessRevision+1}));
    }
    current();
    if (runId !== exploreStore.getState().runId)
      return;
    const instance = createRuntime(account, entry, generation, runId);
    runtime = instance;
    const containerId = await instance.start();
    current();
    if (runtime !== instance || runId !== exploreStore.getState().runId) {
      await instance.stop();
      return;
    }
    exploreStore.setState({ containerId, surfaces: [...parents.map(parent => parent.containerId), containerId], loading: !instance.presented && !exploreStore.getState().error });
    await exploreService.remember(exploreStore.getState().entry ?? entry, account);
  }
  catch (error) {
    if (epoch === generation && runId === exploreStore.getState().runId && signal === launchLife.signal && !signal.aborted) {
      void runtime?.stop();
      runtime = undefined;
      exploreStore.setState({ loading: false, error: error instanceof Error && error.message.startsWith('napplets.') ? error.message : 'napplets.request_failed' });
    }
  }
}
function createRuntime(account: string, entry: ExploreEntry, generation: number, runId: number): ExploreRuntime {
  const current = () => { check(account, generation); if (runtime !== instance) throw new Error('application-not-active'); };
  const connected = () => {
    check(account, generation);
    if (runtime !== instance && !parents.some(parent => parent.runtime === instance)) throw new Error('application-not-active');
  };
  const instance = new ExploreRuntime(account, entry, {
    presented: () => { if (runtime === instance && epoch === generation) exploreStore.setState({ loading: false }); },
    failed: () => { if (runtime === instance && epoch === generation) exploreStore.setState({ loading: false, error: 'napplets.request_failed' }); },
    theme: () => nappletService.currentTheme()?.colors,
    confirm: (prompt, signal) => { current(); return nappletService.requestApproval(prompt, signal); },
    configure: (schema, values, save, signal) => {
      if (runtime !== instance) throw new Error('application-not-active');
      nappletService.configureExternal(schema, values, save, signal);
    },
    applications: async () => {
      connected();
      const apps = await readApplicationHandlers(account, 'napp');
      connected();
      return apps;
    },
    launch: async app => {
      current();
      app = { ...app, required: applicationRequirements(app.kind, app.required) };
      if (await tryOpenApplicationWindow(app, account)) return;
      if (runtime !== instance || parents.length >= 7) throw new Error('application-not-active');
      if (app.required.some(domain => !SUPPORTED_NAPP_DOMAINS.includes(domain))) throw new Error('napplets.unsupported');
      if (!await exploreService.access(app, account)) {
        const answer = await nappletService.requestApproval({ title: app.title, detail: '', accountPubkey: account, application: applicationPresentation(app) }, launchLife.signal);
        check(account, generation);
        if (answer !== 'allow') throw new Error('permission-denied');
        await setData({ accountPubkey: account, appKey: exploreService.signingSource(app) }, 'permissions', 'domains', JSON.stringify(app.required));
      }
      check(account, generation);
      if (runtime !== instance || !instance.containerId) throw new Error('session-closed');
      const parent = { runtime: instance, entry: exploreStore.getState().entry ?? entry, containerId: instance.containerId };
      parents.push(parent);
      const child = createRuntime(account, app, generation, runId);
      runtime = child;
      exploreStore.setState({ entry: app, containerId: null, loading: true, error: null });
      try {
        const containerId = await child.start();
        check(account, generation);
        if (runtime !== child) throw new Error('session-closed');
        exploreStore.setState({ containerId, surfaces: [...parents.map(frame => frame.containerId), containerId], loading: !child.presented });
        await exploreService.remember(app, account);
      } catch (error) {
        await child.stop();
        if (runtime === child) exploreService.close(runId);
        throw error;
      }
    },
    navigated: url => {
      if (epoch !== generation || runtime !== instance) return;
      const address = websiteAddress(url), current = { ...entry, key: address, address, title: new URL(address).host };
      exploreStore.setState({ entry: current });
      void exploreService.remember(current, account).catch(() => {});
    },
    close: () => { if (runtime === instance) exploreService.close(runId); },
    link: url => { current(); void platform.urlOpener.openExternalUrl(websiteAddress(url)).catch(() => {}); },
  });
  return instance;
}
registerNappletLifecycle((account) => { if (!account || exploreStore.getState().account === account)
  exploreService.deactivate(); });
registerNappletVisit((account, release) => {
  if(exploreStore.getState().account!==account) return;
  const app=fromNapplet(release);
  exploreStore.setState(state=>({entries:withVisit(state.entries,app,Date.now())}));
});

registerNappletTheme(() => { runtime?.updateTheme(); for (const parent of parents) parent.runtime.updateTheme(); });

subscribeFavoritesChanged((account, key) => {
  const generation = epoch;
  if (exploreStore.getState().account !== account) return;
  void (async () => {
    await writes;
    if (key) {
      const current = exploreStore.getState().entries.find(entry => entry.key === key);
      if (!current || current.desktopPosition !== null && current.desktopPosition >= exploreStore.getState().favoriteVisibleCount && !metadataLoaded.has(key)) return;
      const [app] = await readFavoriteMetadata(account, [current]);
      check(account, generation);
      if (app) applyMetadata([app]);
      return;
    }
    await refreshFavoriteMembership(account, generation);
  })().catch(() => {});
});

subscribeApplicationMetadata(app => {
  const state = exploreStore.getState();
  if (state.account) applyMetadata([app]);
}, key => {
  const state = exploreStore.getState();
  return state.entries.find(entry => entry.key === key &&
    (entry.desktopPosition !== null && entry.desktopPosition < state.favoriteVisibleCount || metadataLoaded.has(key)));
});
