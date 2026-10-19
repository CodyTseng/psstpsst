import { platform } from '@/platform';
import { createStore } from 'zustand/vanilla';
import { matchFilters } from 'nostr-tools';
import { nappletService, nappletStore } from '@/services/napplet/service';
import { NappletNetwork } from '@/services/napplet/network';
import { MARKET_RELAYS } from '@/services/napplet/protocol';
import { registerNappletLifecycle, registerNappletVisit, registerNappletTheme } from '@/services/napplet/lifecycle';
import { moveDesktopApp } from '@/services/napplet/desktop-order';
import { clearSigningPermissions } from '@/services/signing/repository';
import { normalizeSigningSource } from '@/services/signing/source';
import { getData, setData } from '@/services/napplet/repository';
import { readEntries, reorder, visit, forget } from './repository';
import { fromNapplet, applicationPresentation, applicationRequirements, signedAddress, parseSite, websiteAddress, withVisit, type ExploreEntry } from './model';
import { ExploreRuntime } from './runtime';
import { assertNotAborted } from '@/platform/abort';
import { openApplicationWindow } from './windows';
export const exploreStore = createStore(() => ({ account: null as string | null, loaded: false, entries: [] as ExploreEntry[],
  surfaces: [] as string[], runId: 0, entry: null as ExploreEntry | null, containerId: null as string | null, loading: false, error: null as string | null, accessRevision: 0 }));
let epoch = 0, serial = 0, desktopRevision = 0;
let runtime: ExploreRuntime | undefined;
let navigatingBack: ExploreRuntime | undefined;
const parents: { runtime: ExploreRuntime; entry: ExploreEntry; containerId: string }[] = [];
const readers=new Set<NappletNetwork>();
let launchLife = new AbortController();
let reviewedAccess: {runId:number;required:readonly string[]}|undefined;
export const SUPPORTED_NAPP_DOMAINS = ['identity','network','storage','theme','link','relay','outbox','common','config','inc'];
let writes: Promise<unknown> = Promise.resolve();
const check = (account: string, generation: number) => { if (exploreStore.getState().account !== account || epoch !== generation)
  throw new Error('session-closed'); };
export const exploreService = {
  isCurrentRun(account: string, runId: number) {
    const state=exploreStore.getState();
    return state.account===account && state.runId===runId && !!state.entry;
  },
  async activate(account: string) {
    if (exploreStore.getState().account === account && exploreStore.getState().loaded)
      return;
    this.deactivate();
    const generation = epoch;
    await nappletService.activate(account);
    if (generation !== epoch)
      return;
    exploreStore.setState({ account });
    const entries = await readEntries(account);
    check(account, generation);
    exploreStore.setState({ entries, loaded: true });
  },
  deactivate() { for(const reader of readers) reader.destroy();readers.clear();epoch++; this.stop(); exploreStore.setState({ account: null, loaded: false, entries: [] }); },
  async resolve(value: string): Promise<ExploreEntry> {
    const { account } = exploreStore.getState();
    const generation = epoch;
    if (!account)
      throw new Error('account-unavailable');
    const input = value.trim().replace(/^nostr:/, '');
    if (!/^(naddr|nevent|note)1/i.test(input) && !/^[a-f0-9]{64}$/.test(input)) {
      const address = websiteAddress(input);
      return { key: address, address, title: new URL(address).host, kind: 'website', description: '', servers: [], required: [], desktopPosition: null, lastUsedAt: null };
    }
    const pointer = input.startsWith('naddr1') ? signedAddress(input) : null;
    if (!pointer) {
      const release = await nappletService.resolve(value);
      check(account, generation);
      return fromNapplet(release);
    }
    const network = new NappletNetwork(account);
    readers.add(network);
    try {
      let relays = [...new Set([...pointer.relays, ...MARKET_RELAYS])];
      const query = async () => {
        const response = await network.query(relays, [{ ...pointer.filter, limit: 1 }]);
        check(account, generation);
        return response.events.filter(e => matchFilters([pointer.filter], e)).sort((a, b) => b.created_at - a.created_at || a.id.localeCompare(b.id));
      };
      let events = await query();
      if (!events.length && !pointer.relays.length) {
        relays = await network.publisherRelays(pointer.author);
        check(account, generation);
        if (relays.length)
          events = await query();
      }
      const event = events[0];
      if (!event)
        throw new Error('napplets.not_found');
      const app = parseSite(event);
      if (!app.servers.length) {
        app.servers = await network.mediaServers(pointer.author);
        check(account, generation);
      }
      if (!app.servers.length)
        throw new Error('napplets.download_failed');
      return app;
    }
    finally {
      readers.delete(network);network.destroy();
    }
  },
  async refreshVisit(account: string, key: string) {
    if (exploreStore.getState().account !== account) return;
    const generation = epoch;
    const [app] = await readEntries(account, key);
    if (exploreStore.getState().account !== account || generation !== epoch || !app?.lastUsedAt) return;
    exploreStore.setState(state => {
      const existing = state.entries.find(entry => entry.key === key);
      const updated = existing ? { ...existing, lastUsedAt: Math.max(existing.lastUsedAt ?? 0, app.lastUsedAt!) } : app;
      return { entries: withVisit(state.entries, updated, updated.lastUsedAt!) };
    });
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
    const previous = exploreStore.getState().entries;
    const keys = moveDesktopApp(previous.filter(e => e.desktopPosition !== null).sort((a, b) => a.desktopPosition! - b.desktopPosition!).map(e => e.key), app.key, index);
    const positions = new Map(keys.map((key, i) => [key, i]));
    exploreStore.setState({ entries: (previous.some(e=>e.key===app.key)||index===null?previous:[...previous,{...app,lastUsedAt:null}]).map(e => ({ ...e, desktopPosition: positions.get(e.key) ?? null })) });
    const work = writes.then(async () => { check(account, generation); await reorder(account, keys, app); });
    writes = work.catch(() => { });
    return work.catch(async error=>{
      await writes;
      if(epoch===generation && revision===desktopRevision) {const entries=await readEntries(account);if(epoch===generation && revision===desktopRevision) exploreStore.setState({entries});}
      throw error;
    });
  },
  forget(app: ExploreEntry, account: string) {
    const generation = epoch;
    check(account, generation);
    exploreStore.setState(s => ({ entries: s.entries.map(e => e.key === app.key ? { ...e, lastUsedAt: null } : e) }));
    const work = writes.then(async () => { check(account, generation); await forget(account, app.key); });
    writes = work.catch(() => { });
    return work;
  },
  async access(app: ExploreEntry, account: string) {
    const generation=epoch;
    check(account,generation);
    const stored=await getData({accountPubkey:account,appKey:this.signingSource(app)},'permissions','domains');
    check(account,generation);
    const domains:unknown=stored?JSON.parse(stored):[];
    if(!Array.isArray(domains)||domains.some(domain=>typeof domain!=='string'))throw new Error('invalid-permissions');
    return stored!==null && applicationRequirements(app.kind, app.required).every(domain=>domains.includes(domain));
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
  async start(runId: number) {
    const { account, entry } = exploreStore.getState();
    if (runtime) return;
    const generation = epoch;
    if (!account || !entry || runId !== exploreStore.getState().runId)
      return;
    const signal=launchLife.signal;
    const current=()=>{check(account,generation);assertNotAborted(signal);if(runId!==exploreStore.getState().runId)throw new Error('session-closed');};
    try {
      if (entry.kind === 'napp') {
        if (entry.required.some(d => !SUPPORTED_NAPP_DOMAINS.includes(d)))
          throw new Error('napplets.unsupported');
      }
      const scope = { accountPubkey: account, appKey: this.signingSource(entry) };
      const stored = await getData(scope, 'permissions', 'domains');
      current();
      const grants: string[] = stored ? JSON.parse(stored) : [];
      if (!stored || entry.required.some(d => !grants.includes(d))) {
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
        instance.stop();
        return;
      }
      exploreStore.setState({ containerId, surfaces: [...parents.map(parent => parent.containerId), containerId], loading: !instance.presented && !exploreStore.getState().error });
      await this.remember(exploreStore.getState().entry ?? entry, account);
    }
    catch (error) {
      if (epoch === generation && runId === exploreStore.getState().runId) {
        runtime?.stop();
        runtime = undefined;
        exploreStore.setState({ loading: false, error: error instanceof Error && error.message.startsWith('napplets.') ? error.message : 'napplets.request_failed' });
      }
    }
  },
  retry(runId:number) {
    const state=exploreStore.getState();
    if(state.runId!==runId || !state.entry || !state.error)return;
    runtime?.stop();runtime=undefined;
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
    runtime?.stop();runtime=undefined;
    launchLife.abort();launchLife=new AbortController();
    exploreStore.setState({containerId:null,surfaces:parents.map(parent=>parent.containerId),loading:true,error:null});
  },
  close(runId: number) {
    if (exploreStore.getState().runId !== runId) return;
    const parent = parents.pop();
    if (!parent) { this.stop(runId); return; }
    runtime?.stop(); runtime = parent.runtime;
    exploreStore.setState({ entry: parent.entry, containerId: parent.containerId, surfaces: [...parents.map(frame => frame.containerId), parent.containerId], loading: false, error: null });
  },
  async goBack(runId: number) {
    const active = runtime;
    const overlay = () => { const state = nappletStore.getState(); return state.prompt || state.configuration || state.overlayActive; };
    if (!active || navigatingBack === active || exploreStore.getState().runId !== runId || overlay()) return;
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
    runtime?.stop();
    runtime = undefined;
    for (const parent of parents.splice(0)) parent.runtime.stop();
    exploreStore.setState({ containerId: null, surfaces: [], entry: null, loading: false, error: null });
  },
  async reset(app: ExploreEntry, account: string) {
    const generation = epoch;
    check(account, generation);
    const sourceId = this.signingSource(app);
    const current = exploreStore.getState().entry;
    if (current && this.signingSource(current) === sourceId || parents.some(parent => this.signingSource(parent.entry) === sourceId))
      this.stop();
    await clearSigningPermissions({ accountPubkey: account, sourceId });
    check(account, generation);
    await setData({ accountPubkey: account, appKey: sourceId }, 'permissions', 'domains', null);
    check(account,generation);exploreStore.setState(state=>({accessRevision:state.accessRevision+1}));
  },
  signingSource(app: ExploreEntry) { return app.kind === 'website' ? new URL(app.address).origin : normalizeSigningSource(app.key); },
};
function createRuntime(account: string, entry: ExploreEntry, generation: number, runId: number): ExploreRuntime {
  const instance = new ExploreRuntime(account, entry, {
    accountAccessGranted: true,
    presented: () => { if (runtime === instance && epoch === generation) exploreStore.setState({ loading: false }); },
    failed: () => { if (runtime === instance && epoch === generation) exploreStore.setState({ loading: false, error: 'napplets.request_failed' }); },
    theme: () => nappletService.currentTheme()?.colors,
    confirm: nappletService.requestApproval,
    configure: (schema, values, save, signal) => {
      if (runtime !== instance) throw new Error('application-not-active');
      nappletService.configureExternal(schema, values, save, signal);
    },
    applications: async () => { check(account, generation); return exploreStore.getState().entries; },
    application: async sourceId => {
      check(account, generation);
      const cached = exploreStore.getState().entries.find(app => app.key === sourceId);
      if (cached) return cached;
      const [app] = await readEntries(account, sourceId); check(account, generation);
      return app;
    },
    launch: async app => {
      check(account, generation);
      app = { ...app, required: applicationRequirements(app.kind, app.required) };
      if (platform.napplet.windows) { await openApplicationWindow(app, account); return; }
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
      const parent = { runtime: instance, entry, containerId: instance.containerId };
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
        child.stop();
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
    link: url => { void platform.urlOpener.openExternalUrl(websiteAddress(url)).catch(() => {}); },
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
