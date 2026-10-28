import { needsFavoriteMetadata, resolveFavoriteMetadata } from '../favorite-metadata';
import { notifyFavoritesChanged } from '../favorites-events';
import { exploreService,exploreStore } from '../service';
import { applicationTasks, applicationTaskStore } from '../application-tasks';
import { nappletService } from '@/services/napplet/service';
import { NappletRuntime } from '@/services/napplet/runtime';
import type { NappletRelease } from '@/services/napplet/protocol';
import { getData,setData } from '@/services/napplet/repository';
import { readEntries, readFavoriteEntries, readFavoriteReferences, readFavoriteMetadata, queueFavoritesPublication, reorder, visit } from '../repository';
import { ExploreRuntime } from '../runtime';
import type { ExploreEntry } from '../model';
import { naddrEncode } from 'nostr-tools/nip19';
import { tryOpenApplicationWindow } from '../windows';
import { platform } from '@/platform';
import { refreshApplicationMetadata } from '../application-metadata';
import { notifyApplicationChange } from '../application-changes';
import { removeLocalApplication } from '../local-applications';
let mockDatabaseListener: (event: { tableName?: string; external?: boolean }) => void;
jest.mock('../application-metadata', () => ({ refreshApplicationMetadata: jest.fn(async () => {}), subscribeApplicationMetadata: jest.requireActual('../application-changes').subscribeApplicationChanges }));
jest.mock('@/services/relay/replaceable-events.service', () => ({ invalidateReplaceableEvents: jest.fn() }));
jest.mock('../browser-permission-store', () => ({ clearBrowserPermissions: jest.fn(async () => {}) }));
jest.mock('../local-applications', () => ({ removeLocalApplication: jest.fn(async () => {}) }));
jest.mock('@/platform',()=>({platform:{database:{addChangeListener:jest.fn(listener=>{mockDatabaseListener=listener;return jest.fn();})},urlOpener:{openExternalUrl:jest.fn()},napplet:{tasks:{open:jest.fn(async()=>{}),focus:jest.fn(async()=>{}),close:jest.fn(async()=>{}),onClosed:jest.fn()}}}}));
jest.mock('@/services/account/account-receive-guard',()=>({canReceiveForAccount:jest.fn(async()=>true)}));
jest.mock('@/services/napplet/artifacts',()=>({loadArtifact:jest.fn()}));
jest.mock('@/services/napplet/runtime',()=>({NappletRuntime:jest.fn()}));
jest.mock('@/services/napplet/service',()=>({nappletStore:{getState:()=>({accountPubkey:'account'})},nappletService:{activate:jest.fn(async()=>{}),activateAccount:jest.fn(async()=>{}),install:jest.fn(async()=>{}),stop:jest.fn(),requestApproval:jest.fn(async()=> 'allow'),currentTheme:()=>undefined}}));
jest.mock('@/services/napplet/network',()=>({NappletNetwork:jest.fn()}));
jest.mock('@/services/napplet/lifecycle',()=>({registerNappletLifecycle:jest.fn(),registerNappletVisit:jest.fn(),registerNappletTheme:jest.fn(),registerNappletSourceInvalidation:jest.fn(),invalidateNappletSource:jest.fn()}));
jest.mock('@/services/signing/repository',()=>({clearSigningPermissions:jest.fn(async()=>{})}));
jest.mock('@/services/napplet/repository',()=>({getData:jest.fn(async()=>null),setData:jest.fn(async()=>{})}));
jest.mock('../favorite-metadata', () => ({ needsFavoriteMetadata: jest.fn((entry: ExploreEntry) => entry.kind !== 'website' && !entry.manifest), resolveFavoriteMetadata: jest.fn(async (_account: string, entry: ExploreEntry) => entry) }));
jest.mock('../repository',()=>({queueFavoritesPublication:jest.fn(),readEntries:jest.fn(async()=>[]),readFavoriteEntries:jest.fn(async()=>[]),readFavoriteReferences:jest.fn(async()=>[]),readFavoriteMetadata:jest.fn(async(_account:string,page:ExploreEntry[])=>page),visit:jest.fn(async()=>{}),fromNapplet:jest.fn(),reorder:jest.fn(),forget:jest.fn()}));
jest.mock('../runtime',()=>({ExploreRuntime:jest.fn().mockImplementation(function(this: object){Object.assign(this,{start:jest.fn(async()=> 'container'),stop:jest.fn(),presented:true});})}));
const website:ExploreEntry={key:'https://site.example/path',address:'https://site.example/path',title:'Site',kind:'website',required:[],description:'',servers:[],lastUsedAt:null,desktopPosition:null};
function entry(kind:'website'|'nsite'|'napp'):ExploreEntry {
  if(kind==='website')return website;
  const key=naddrEncode({kind:kind==='napp'?35130:35128,pubkey:'a'.repeat(64),identifier:'test'});
  return {...website,kind,key,address:key};
}
beforeEach(async()=>{jest.clearAllMocks();jest.mocked(needsFavoriteMetadata).mockReturnValue(false);jest.mocked(resolveFavoriteMetadata).mockImplementation(async (_account, app) => app);jest.mocked(getData).mockResolvedValue(null);jest.mocked(nappletService.requestApproval).mockResolvedValue('allow');await exploreService.activate('account');});
afterEach(async()=>{exploreService.deactivate();for(const id of applicationTaskStore.getState().sessions.keys())await applicationTasks.close(id);});
it.each(['other', 'account'])('does not update a new %s session after an old uninstall completes', async nextAccount => {
  const app: ExploreEntry = { ...website, key: 'local~hello', address: 'local~hello', kind: 'napp',
    local: { version: 'a'.repeat(64), installer: website.key, actions: [] } };
  exploreStore.setState({ entries: [app] });
  let finish!: () => void, started!: () => void;
  const removing = new Promise<void>(resolve => { started = resolve; });
  jest.mocked(removeLocalApplication).mockImplementationOnce(async () => {
    started(); await new Promise<void>(resolve => { finish = resolve; });
  });
  const pending = exploreService.uninstallLocal(app, 'account');
  await Promise.race([removing, pending]);
  try {
    exploreService.deactivate();
    const independent = { ...app, title: 'Independent installation' };
    jest.mocked(readFavoriteEntries).mockResolvedValueOnce([independent]);
    await exploreService.activate(nextAccount);
    const before = exploreStore.getState();
    finish(); await pending;
    expect(removeLocalApplication).toHaveBeenCalledWith('account', app.key);
    expect(exploreStore.getState()).toBe(before);
    expect(exploreStore.getState().entries).toEqual([independent]);
  } finally { finish(); await pending; }
});

it('removes only the uninstalled entry when its account session remains active', async () => {
  const app: ExploreEntry = { ...website, key: 'local~hello', address: 'local~hello', kind: 'napp',
    local: { version: 'a'.repeat(64), installer: website.key, actions: [] } };
  exploreStore.setState({ entries: [app, website] });
  await exploreService.uninstallLocal(app, 'account');
  expect(removeLocalApplication).toHaveBeenCalledWith('account', app.key);
  expect(exploreStore.getState().entries).toEqual([website]);
});

it('keeps websites inline by default and opens a task for an explicit window choice', async () => {
  expect(await tryOpenApplicationWindow(website, 'account')).toBe(false);
  expect(platform.napplet.tasks!.open).not.toHaveBeenCalled();
  jest.mocked(getData).mockResolvedValueOnce('true');
  expect(await tryOpenApplicationWindow(website, 'account')).toBe(true);
  expect(platform.napplet.tasks!.open).toHaveBeenCalledTimes(1);
});
it('always opens applications independently despite an old inline choice', async () => {
  expect(await tryOpenApplicationWindow(entry('napp'), 'account')).toBe(true);
  expect(platform.napplet.tasks!.open).toHaveBeenCalledTimes(1);
  jest.mocked(getData).mockResolvedValue('false');
  expect(await tryOpenApplicationWindow(entry('napp'), 'account')).toBe(true);
  expect(getData).not.toHaveBeenCalled();
  expect(platform.napplet.tasks!.open).toHaveBeenCalledTimes(1);
});
it.each(['website','nsite'] as const)('opens %s without required access or a first-use approval',async kind=>{
  const app=entry(kind);
  expect(await exploreService.access(app,'account')).toBe(true);
  const runId=exploreService.prepare(app,'account');
  await exploreService.start(runId);
  expect(nappletService.requestApproval).not.toHaveBeenCalled();
  expect(setData).not.toHaveBeenCalled();
  expect(ExploreRuntime).toHaveBeenCalledWith('account',app,expect.objectContaining({confirm:expect.any(Function)}));
});
it.each(['website','nsite','napp'] as const)('reviews missing required access and remembers it for %s',async kind=>{
  const app={...entry(kind),required:['network']};
  expect(await exploreService.access(app,'account')).toBe(false);
  const runId=exploreService.prepare(app,'account');
  await exploreService.start(runId);
  expect(nappletService.requestApproval).toHaveBeenCalledWith(expect.objectContaining({application:expect.objectContaining({required:['network']}),accountPubkey:'account'}),expect.anything());
  expect(setData).toHaveBeenCalledWith({accountPubkey:'account',appKey:exploreService.signingSource(app)},'permissions','domains','["network"]');
  jest.mocked(nappletService.requestApproval).mockClear();jest.mocked(getData).mockResolvedValue('["network"]');
  expect(await exploreService.access(app,'account')).toBe(true);
  const again=exploreService.prepare(app,'account');await exploreService.start(again);
  expect(nappletService.requestApproval).not.toHaveBeenCalled();
});
it('reviews implicit network access for napps with no declared requirements',async()=>{
  const app=entry('napp');
  expect(await exploreService.access(app,'account')).toBe(false);
  await exploreService.start(exploreService.prepare(app,'account'));
  expect(nappletService.requestApproval).toHaveBeenCalledWith(expect.objectContaining({application:expect.objectContaining({required:['network']})}),expect.anything());
});
it('does not open a container when first-use approval is refused',async()=>{
  jest.mocked(nappletService.requestApproval).mockResolvedValue(false);
  const id=exploreService.prepare({...website,required:['network']},'account');await exploreService.start(id);
  expect(ExploreRuntime).not.toHaveBeenCalled();expect(setData).not.toHaveBeenCalled();
  expect(exploreStore.getState().containerId).toBeNull();
});
it('does not display first-use consent for a launch replaced while storage was loading',async()=>{
  let finish!:(value:null)=>void;
  jest.mocked(getData).mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;}));
  const old=exploreService.prepare(website,'account');const start=exploreService.start(old);
  exploreService.prepare({...website,key:'https://other.example/',address:'https://other.example/'},'account');
  finish(null);await start;
  expect(nappletService.requestApproval).not.toHaveBeenCalled();expect(ExploreRuntime).not.toHaveBeenCalled();
});

it('accepts exactly reviewed details-page access without showing a duplicate first-use sheet',async()=>{
  const app={...entry('napp'),required:['network','relay']};
  const id=exploreService.prepare(app,'account',['network','relay']);await exploreService.start(id);
  expect(nappletService.requestApproval).not.toHaveBeenCalled();
  expect(setData).toHaveBeenCalledWith(expect.anything(),'permissions','domains','["network","relay"]');
});
it('asks again when the reviewed requirements differ from the launched manifest',async()=>{
  const app={...entry('napp'),required:['relay','network']};
  const id=exploreService.prepare(app,'account',['relay']);await exploreService.start(id);
  expect(nappletService.requestApproval).toHaveBeenCalledTimes(1);
});

it('persists a discovered favorite without recording a visit',async()=>{
  await exploreService.move(website,0,'account');
  expect(exploreStore.getState().entries).toEqual([{...website,desktopPosition:0,lastUsedAt:null}]);
  expect(reorder).toHaveBeenCalledWith('account',[website.key],website);
  expect(visit).not.toHaveBeenCalled();
});

it('keeps favorite membership readable by an inline caller while its target is in front', async () => {
  const tasks = platform.napplet.tasks;
  platform.napplet.tasks = undefined;
  try {
    const caller = entry('napp');
    const target = { ...caller, key: 'target', address: 'target', desktopPosition: 0 };
    jest.mocked(readFavoriteReferences).mockResolvedValueOnce([target]).mockResolvedValueOnce([]);
    const runId = exploreService.prepare(caller, 'account');
    await exploreService.start(runId);
    const instance = jest.mocked(ExploreRuntime).mock.instances.at(-1)!;
    instance.containerId = 'caller-container';
    const options = jest.mocked(ExploreRuntime).mock.calls.at(-1)![2];
    await options.launch!(target);
    await expect(options.applications!()).resolves.toEqual([target]);
    await expect(options.applications!()).resolves.toEqual([]);
  } finally { platform.napplet.tasks = tasks; }
});

it.each(['website','nsite'] as const)('opens an independent %s task without empty launch consent',async kind=>{
  const app=entry(kind);
  await applicationTasks.open(app,'account');
  const id=[...applicationTaskStore.getState().sessions.keys()][0];
  await applicationTasks.start(id);
  expect(applicationTaskStore.getState().sessions.get(id)?.containerId).toBe('container');
  expect(nappletService.requestApproval).not.toHaveBeenCalled();
  expect(setData).not.toHaveBeenCalled();
});
it('still reviews required access for an independent task',async()=>{
  await applicationTasks.open(entry('napp'),'account');
  const id=[...applicationTaskStore.getState().sessions.keys()][0];
  await applicationTasks.start(id);
  expect(nappletService.requestApproval).toHaveBeenCalledWith(expect.objectContaining({application:expect.objectContaining({required:['network']})}),expect.anything());
  expect(applicationTaskStore.getState().sessions.get(id)?.containerId).toBe('container');
});

it.each([false, true])('applies default optional access in independent napplet tasks with storage denied: %s', async denied => {
  const app = { ...entry('napp'), kind: 'napplet' as const };
  app.release = { key: app.key, required: [], optional: ['theme', 'storage', 'config', 'identity'] } as unknown as NappletRelease;
  jest.mocked(getData).mockImplementation(async (_scope, bucket, name) => {
    if (bucket !== 'permissions') return null;
    if (name === 'domains') return '["shell"]';
    return name === 'denied-domains' && denied ? '["storage"]' : null;
  });
  jest.mocked(NappletRuntime).mockImplementationOnce(function(this: object) {
    Object.assign(this, { open: jest.fn(async () => 'napplet-container'), close: jest.fn(async () => {}) });
    return this as NappletRuntime;
  });
  await applicationTasks.open(app, 'account');
  const id = [...applicationTaskStore.getState().sessions.keys()].at(-1)!;
  await applicationTasks.start(id);
  expect(jest.mocked(NappletRuntime).mock.calls.at(-1)![0].domains).toEqual(
    denied ? ['shell', 'theme', 'config'] : ['shell', 'theme', 'storage', 'config']);
  expect(applicationTaskStore.getState().sessions.get(id)?.containerId).toBe('napplet-container');
  expect(nappletService.requestApproval).not.toHaveBeenCalled();
});

it('refreshes remote favorite order and applies metadata completion without overwriting it', async () => {
  exploreStore.setState({ entries: [{ ...website, desktopPosition: 3, lastUsedAt: 10 }] });
  jest.mocked(readFavoriteReferences).mockResolvedValueOnce([{ ...website, desktopPosition: 0, lastUsedAt: null }]);
  notifyFavoritesChanged('account');
  for (let i = 0; i < 20; i++) await Promise.resolve();
  expect(exploreStore.getState().entries[0].desktopPosition).toBe(0);
  jest.mocked(readFavoriteMetadata).mockResolvedValueOnce([{ ...website, title: 'Resolved', desktopPosition: 4, lastUsedAt: 99 }]);
  notifyFavoritesChanged('account', website.key);
  for (let i = 0; i < 20; i++) await Promise.resolve();
  expect(readFavoriteMetadata).toHaveBeenLastCalledWith('account', [expect.objectContaining({ key: website.key })]);
  expect(exploreStore.getState().entries[0]).toMatchObject({ title: 'Resolved', desktopPosition: 0, lastUsedAt: 10 });
});

it('closes the inline page only after its independent window opens', async () => {
  const runId = exploreService.prepare(website, 'account');
  await exploreService.start(runId);
  const instance = jest.mocked(ExploreRuntime).mock.instances.at(-1)!;
  let opened!: () => void;
  jest.mocked(platform.napplet.tasks!.open).mockImplementationOnce(() => new Promise<void>(resolve => { opened = resolve; }));
  const launch = exploreService.openInWindow(runId);
  // The native launch awaits account and metadata checks first.
  await new Promise(resolve => setTimeout(resolve, 0));
  expect(exploreStore.getState().entry).toEqual(website);
  expect(instance.stop).not.toHaveBeenCalled();
  opened();
  await launch;
  expect(instance.stop).toHaveBeenCalledTimes(1);
  expect(exploreStore.getState().entry).toBeNull();
  expect(exploreStore.getState().surfaces).toEqual([]);
  expect(setData).not.toHaveBeenCalled();
});

it('keeps the inline page available when opening a window fails', async () => {
  const runId = exploreService.prepare(website, 'account');
  await exploreService.start(runId);
  jest.mocked(platform.napplet.tasks!.open).mockRejectedValueOnce(new Error('open-failed'));
  await expect(exploreService.openInWindow(runId)).rejects.toThrow('open-failed');
  expect(exploreStore.getState().entry).toEqual(website);
  expect(exploreStore.getState().containerId).toBe('container');
});

it('does not close a newer inline session after a delayed window launch', async () => {
  const runId = exploreService.prepare(website, 'account');
  await exploreService.start(runId);
  let opened!: () => void;
  jest.mocked(platform.napplet.tasks!.open).mockImplementationOnce(() => new Promise<void>(resolve => { opened = resolve; }));
  const launch = exploreService.openInWindow(runId);
  await new Promise(resolve => setTimeout(resolve, 0));
  const next = { ...website, address: 'https://another.example/', key: 'https://another.example/' };
  const nextRun = exploreService.prepare(next, 'account');
  await exploreService.start(nextRun);
  opened();
  await launch;
  expect(exploreStore.getState().runId).toBe(nextRun);
  expect(exploreStore.getState().entry).toEqual(next);
});

it('shares one local first-page read without preparing runtimes, history, publishing or polling', async () => {
  exploreService.deactivate();
  jest.clearAllMocks();
  let finish!: (entries: ExploreEntry[]) => void;
  jest.mocked(readFavoriteEntries).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const first = exploreService.activate('account'), second = exploreService.activate('account');
  expect(readFavoriteEntries).toHaveBeenCalledTimes(1);
  finish([{ ...website, desktopPosition: 0 }]);
  await Promise.all([first, second]);
  jest.useFakeTimers();
  try {
    await jest.advanceTimersByTimeAsync(120_000);
    expect(readFavoriteEntries).toHaveBeenCalledTimes(1);
    expect(readEntries).not.toHaveBeenCalled();
    expect(readFavoriteMetadata).not.toHaveBeenCalled();
    expect(nappletService.activateAccount).not.toHaveBeenCalled();
    expect(refreshApplicationMetadata).not.toHaveBeenCalled();
    expect(queueFavoritesPublication).not.toHaveBeenCalled();
  } finally { jest.useRealTimers(); }
});

it('queries Favorites again on entry without stopping a running application', async () => {
  const runId = exploreService.prepare(website, 'account');
  await exploreService.start(runId);
  jest.clearAllMocks();
  await exploreService.activate('account');
  jest.mocked(readFavoriteEntries).mockResolvedValueOnce([{ ...website, title: 'Fresh', desktopPosition: 0 }]);
  await exploreService.activate('account', { refresh: true });
  expect(readFavoriteEntries).toHaveBeenCalledTimes(1);
  expect(exploreStore.getState()).toMatchObject({ runId, entry: website, entries: [{ ...website, title: 'Fresh', desktopPosition: 0 }], favoriteVisibleCount: 50 });
  expect(ExploreRuntime).not.toHaveBeenCalled();
  expect(readFavoriteMetadata).not.toHaveBeenCalled();
  expect(nappletService.activateAccount).not.toHaveBeenCalled();
});

it('displays saved titles before first-page manifest hydration finishes', async () => {
  exploreService.deactivate();
  jest.useFakeTimers();
  const app = { ...entry('napp'), title: 'Saved title', desktopPosition: 0 };
  let finish!: (entries: ExploreEntry[]) => void;
  jest.mocked(readFavoriteEntries).mockResolvedValueOnce([app]);
  jest.mocked(readFavoriteMetadata).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  try {
    await exploreService.activate('account');
    expect(exploreStore.getState()).toMatchObject({ loaded: true, entries: [app] });
    expect(readFavoriteMetadata).not.toHaveBeenCalled();
    await jest.advanceTimersByTimeAsync(0);
    expect(readFavoriteMetadata).toHaveBeenCalledWith('account', [app]);
    expect(exploreStore.getState().loaded).toBe(true);
    finish([{ ...app, title: 'Current title' }]);
    for (let index = 0; index < 20; index++) await Promise.resolve();
    expect(exploreStore.getState().entries[0].title).toBe('Current title');
  } finally { jest.useRealTimers(); }
});

it('keeps a shortcut edit made while the entry query is pending', async () => {
  exploreStore.setState({ entries: [{ ...website, desktopPosition: 0 }] });
  let finish!: (entries: ExploreEntry[]) => void;
  jest.mocked(readFavoriteEntries).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const refresh = exploreService.activate('account', { refresh: true });
  await Promise.resolve();
  await exploreService.move(website, null, 'account');
  finish([{ ...website, title: 'Updated', desktopPosition: 0 }]);
  await refresh;
  expect(exploreStore.getState().entries[0]).toMatchObject({ title: 'Updated', desktopPosition: null });
});

it('does not wait for an unfinished history write before displaying Favorites', async () => {
  let finish!: () => void;
  jest.mocked(visit).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const write = exploreService.remember(website, 'account');
  await Promise.resolve();
  jest.mocked(readFavoriteEntries).mockResolvedValueOnce([{ ...website, desktopPosition: 0 }]);
  await exploreService.activate('account', { refresh: true });
  expect(exploreStore.getState()).toMatchObject({ loaded: true, entries: [{ ...website, desktopPosition: 0 }] });
  finish();
  await write;
});

it('reads only the requested next page and keeps a shortcut edit made during that read', async () => {
  exploreService.deactivate();
  const favorites = Array.from({ length: 123 }, (_, index) => ({ ...website, key: `app-${index}`, desktopPosition: index }));
  jest.mocked(readFavoriteEntries).mockResolvedValueOnce(favorites);
  await exploreService.activate('account');
  jest.clearAllMocks();
  let finish!: (entries: ExploreEntry[]) => void;
  jest.mocked(readFavoriteMetadata).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const first = exploreService.loadMoreFavorites('account'), repeated = exploreService.loadMoreFavorites('account');
  expect(readFavoriteMetadata).toHaveBeenCalledTimes(1);
  expect(readFavoriteMetadata).toHaveBeenCalledWith('account', favorites.slice(50, 100));
  expect(exploreStore.getState()).toMatchObject({ favoriteVisibleCount: 50, favoritesLoadingMore: true });
  await exploreService.move(favorites[50], 0, 'account');
  finish(favorites.slice(50, 100).map(entry => ({ ...entry, title: 'Page metadata' })));
  await Promise.all([first, repeated]);
  expect(exploreStore.getState().favoriteVisibleCount).toBe(100);
  expect(exploreStore.getState().entries.find(entry => entry.key === 'app-50')).toMatchObject({ title: 'Page metadata', desktopPosition: 0 });
  expect(readEntries).not.toHaveBeenCalled();
  await exploreService.loadMoreFavorites('account');
  expect(jest.mocked(readFavoriteMetadata).mock.calls.at(-1)![1]).toHaveLength(23);
  expect(exploreStore.getState().favoriteVisibleCount).toBe(123);
});

it('ignores history changes and applies global metadata events without rereading the database', async () => {
  exploreService.deactivate();
  jest.mocked(readFavoriteEntries).mockResolvedValueOnce([{ ...website, desktopPosition: 0 }]);
  await exploreService.activate('account');
  jest.clearAllMocks();
  jest.useFakeTimers();
  try {
    mockDatabaseListener({ external: true, tableName: 'explore_history' });
    mockDatabaseListener({ external: true, tableName: 'explore_entries' });
    await jest.advanceTimersByTimeAsync(100);
    notifyApplicationChange({ ...website, title: 'Global metadata' });
    expect(exploreStore.getState().entries[0]).toMatchObject({ title: 'Global metadata', desktopPosition: 0 });
    expect(readFavoriteEntries).not.toHaveBeenCalled();
    expect(readFavoriteReferences).not.toHaveBeenCalled();
    expect(readFavoriteMetadata).not.toHaveBeenCalled();
    expect(readEntries).not.toHaveBeenCalled();
  } finally { jest.useRealTimers(); }
});

it.each([{}, { tableName: 'local_applications' }, { external: true, tableName: 'local_applications' }])(
  'reconciles local replacements and uninstallations after database notification %j', async event => {
    exploreService.deactivate();
    jest.useFakeTimers();
    try {
      const local: ExploreEntry = { ...website, key: 'local~hello', address: 'local~hello', kind: 'napp', desktopPosition: 0, lastUsedAt: 123,
        local: { version: 'a'.repeat(64), installer: website.key, actions: [] },
        localIcon: { account: 'account', appId: 'local~hello', version: 'a'.repeat(64), hash: 'b'.repeat(64) },
        files: [{ path: '/index.html', hash: 'b'.repeat(64), mime: 'text/html' }] };
      const other = { ...website, desktopPosition: 1 };
      jest.mocked(readFavoriteEntries).mockResolvedValueOnce([local, other]);
      await exploreService.activate('account');
      await jest.advanceTimersByTimeAsync(0);
      const unchanged = exploreStore.getState().entries[1];
      const replacement = { ...local, files: undefined, local: { ...local.local!, version: 'c'.repeat(64) },
        localIcon: { ...local.localIcon!, version: 'c'.repeat(64) } };
      jest.mocked(readFavoriteReferences).mockClear();
      jest.mocked(readFavoriteReferences).mockResolvedValueOnce([replacement, other]);
      mockDatabaseListener(event); mockDatabaseListener(event); mockDatabaseListener(event);
      await jest.advanceTimersByTimeAsync(40);
      expect(readFavoriteReferences).toHaveBeenCalledTimes(1);
      expect(readFavoriteReferences).toHaveBeenCalledWith('account');
      expect(exploreStore.getState().entries[0]).toMatchObject({ local: replacement.local, localIcon: replacement.localIcon, lastUsedAt: 123 });
      expect(exploreStore.getState().entries[0].files).toBeUndefined();
      expect(exploreStore.getState().entries[1]).toBe(unchanged);
      jest.mocked(readFavoriteReferences).mockResolvedValueOnce([{ ...other, desktopPosition: 0 }]);
      mockDatabaseListener(event);
      await jest.advanceTimersByTimeAsync(40);
      expect(exploreStore.getState().entries.filter(entry => entry.desktopPosition !== null).map(entry => entry.key)).toEqual([other.key]);
    } finally { jest.useRealTimers(); }
  },
);

it('cancels queued unscoped reconciliation when switching accounts', async () => {
  jest.useFakeTimers();
  try {
    jest.mocked(readFavoriteReferences).mockClear();
    mockDatabaseListener({});
    await exploreService.activate('other');
    await jest.advanceTimersByTimeAsync(100);
    expect(exploreStore.getState().account).toBe('other');
    expect(readFavoriteReferences).not.toHaveBeenCalled();
  } finally { jest.useRealTimers(); }
});

it('loads unseen metadata only for an explicit collection search and reuses settled pages', async () => {
  exploreService.deactivate();
  const favorites = Array.from({ length: 123 }, (_, index) => ({ ...website, key: `search-${index}`, desktopPosition: index }));
  jest.mocked(readFavoriteEntries).mockResolvedValueOnce(favorites);
  await exploreService.activate('account');
  jest.mocked(readFavoriteMetadata).mockClear();
  await exploreService.loadFavoriteSearchMetadata('account');
  expect(jest.mocked(readFavoriteMetadata).mock.calls.map(call => call[1].length)).toEqual([50, 23]);
  expect(exploreStore.getState().favoriteVisibleCount).toBe(50);
  await exploreService.loadFavoriteSearchMetadata('account');
  expect(readFavoriteMetadata).toHaveBeenCalledTimes(2);
});

it('ignores table-level metadata invalidations and changes only the notified favorite item', async () => {
  exploreService.deactivate();
  const favorites = Array.from({ length: 123 }, (_, index) => ({ ...website, key: `external-${index}`, desktopPosition: index }));
  jest.mocked(readFavoriteEntries).mockResolvedValueOnce(favorites);
  await exploreService.activate('account');
  jest.clearAllMocks();
  jest.useFakeTimers();
  try {
    mockDatabaseListener({ external: true, tableName: 'cached_events' });
    await jest.advanceTimersByTimeAsync(100);
    expect(readFavoriteMetadata).not.toHaveBeenCalled();
    const before = exploreStore.getState();
    notifyApplicationChange({ ...favorites[23], title: 'Changed item', description: 'Changed description' });
    const after = exploreStore.getState();
    expect(after.favoriteVisibleCount).toBe(before.favoriteVisibleCount);
    favorites.forEach((entry, index) => {
      if (index === 23) expect(after.entries[index]).toMatchObject({ title: 'Changed item', description: 'Changed description', desktopPosition: 23 });
      else expect(after.entries[index]).toBe(before.entries[index]);
    });
    expect(readFavoriteReferences).not.toHaveBeenCalled();
    expect(readFavoriteEntries).not.toHaveBeenCalled();
  } finally { jest.useRealTimers(); }
});

it('allows another initialization attempt after a failed local Favorites read', async () => {
  exploreService.deactivate();
  jest.mocked(readFavoriteEntries).mockClear();
  jest.mocked(readFavoriteEntries).mockRejectedValueOnce(new Error('database-busy'));
  await expect(exploreService.activate('account')).rejects.toThrow('database-busy');
  await exploreService.activate('account');
  expect(readFavoriteEntries).toHaveBeenCalledTimes(2);
  expect(exploreStore.getState().loaded).toBe(true);
});

it('does not let an old account read replace the active account snapshot', async () => {
  exploreService.deactivate();
  let firstReady!: (entries: ExploreEntry[]) => void, secondReady!: (entries: ExploreEntry[]) => void;
  jest.mocked(readFavoriteEntries)
    .mockImplementationOnce(() => new Promise(resolve => { firstReady = resolve; }))
    .mockImplementationOnce(() => new Promise(resolve => { secondReady = resolve; }));
  const first = exploreService.activate('first'), second = exploreService.activate('second');
  firstReady([{ ...website, title: 'Old account' }]);
  await first;
  const repeated = exploreService.activate('second');
  secondReady([{ ...website, title: 'Active account' }]);
  await Promise.all([second, repeated]);
  expect(exploreStore.getState()).toMatchObject({ account: 'second', loaded: true, entries: [{ ...website, title: 'Active account' }] });
});

it('releases the old inline runtime and keeps a retryable error when an update cannot start', async () => {
  const app = entry('napp'), runId = exploreService.prepare(app, 'account');
  await exploreService.start(runId);
  const old = jest.mocked(ExploreRuntime).mock.instances.at(-1)!;
  jest.mocked(ExploreRuntime).mockImplementationOnce(function(this: object) {
    Object.assign(this, { start: jest.fn(async () => { throw new Error('download-failed'); }), stop: jest.fn(), presented: true });
    return this as ExploreRuntime;
  });
  await expect(exploreService.restart(runId, { ...app, title: 'Updated' })).rejects.toThrow();
  expect(old.stop).toHaveBeenCalledTimes(1);
  expect(exploreStore.getState()).toMatchObject({ entry: { key: app.key, title: 'Updated', required: ['network'] }, containerId: null, error: 'applications.request_failed' });
});

it('closes an old inline runtime before starting the replacement', async () => {
  const app = entry('napp'), runId = exploreService.prepare(app, 'account');
  await exploreService.start(runId);
  const old = jest.mocked(ExploreRuntime).mock.instances.at(-1)!;
  jest.mocked(ExploreRuntime).mockImplementationOnce(function(this: object) {
    expect(old.stop).toHaveBeenCalledTimes(1);
    Object.assign(this, { start: jest.fn(async () => 'container'), stop: jest.fn(), presented: true });
    return this as ExploreRuntime;
  });
  await exploreService.restart(runId, { ...app, title: 'Updated' });
  expect(old.stop).toHaveBeenCalledTimes(1);
  expect(exploreStore.getState()).toMatchObject({ entry: { title: 'Updated' }, containerId: 'container' });
});

it('shares restart initialization with route startup while cleanup and permission reads are pending', async () => {
  const app = entry('napp'), id = exploreService.prepare(app, 'account');
  await exploreService.start(id);
  const old = jest.mocked(ExploreRuntime).mock.instances.at(-1)!;
  let cleaned!: () => void, permissions!: (value: string) => void;
  jest.mocked(old.stop).mockReturnValueOnce(new Promise<void>(resolve => { cleaned = resolve; }));
  jest.mocked(getData).mockClear();
  jest.mocked(getData).mockImplementationOnce(() => new Promise(resolve => { permissions = resolve; }));
  jest.mocked(nappletService.requestApproval).mockClear();
  const restart = exploreService.restart(id, { ...app, title: 'Updated' });
  const route = exploreService.start(id);
  expect(getData).not.toHaveBeenCalled();
  expect(ExploreRuntime).toHaveBeenCalledTimes(1);
  cleaned();
  await Promise.resolve();
  const repeated = exploreService.start(id);
  expect(getData).toHaveBeenCalledTimes(1);
  permissions('["network"]');
  await Promise.all([restart, route, repeated]);
  expect(ExploreRuntime).toHaveBeenCalledTimes(2);
  expect(nappletService.requestApproval).not.toHaveBeenCalled();
});

it('ignores retiring task callbacks while a replacement runtime starts', async () => {
  const app = entry('napp');
  await applicationTasks.open(app, 'account');
  const id = [...applicationTaskStore.getState().sessions.keys()].at(-1)!;
  await applicationTasks.start(id);
  const callbacks = jest.mocked(ExploreRuntime).mock.calls.at(-1)![2];
  let ready!: (id: string) => void;
  jest.mocked(ExploreRuntime).mockImplementationOnce(function(this: object) {
    Object.assign(this, { start: jest.fn(() => new Promise<string>(resolve => { ready = resolve; })), stop: jest.fn(), presented: false });
    return this as ExploreRuntime;
  });
  const replacing = applicationTasks.restart(id, { ...app, title: 'Updated' });
  await new Promise(resolve => setTimeout(resolve, 0));
  callbacks.presented?.(); callbacks.failed?.(); callbacks.navigated?.('https://unrelated.example/'); callbacks.close?.();
  expect(applicationTaskStore.getState().sessions.get(id)).toMatchObject({ entry: { title: 'Updated' }, loading: true });
  expect(platform.napplet.tasks!.close).not.toHaveBeenCalled();
  ready('replacement'); await replacing;
});

it('waits for old task resources to close and shares initialization with the task surface', async () => {
  const app = entry('napp');
  await applicationTasks.open(app, 'account');
  const id = [...applicationTaskStore.getState().sessions.keys()].at(-1)!;
  await applicationTasks.start(id);
  const old = jest.mocked(ExploreRuntime).mock.instances.at(-1)!;
  let closed!: () => void;
  jest.mocked(old.stop).mockReturnValueOnce(new Promise<void>(resolve => { closed = resolve; }));
  const restarting = applicationTasks.restart(id, { ...app, title: 'Updated' });
  const surface = applicationTasks.start(id);
  expect(ExploreRuntime).toHaveBeenCalledTimes(1);
  expect(applicationTaskStore.getState().sessions.get(id)?.containerId).toBeUndefined();
  closed(); await Promise.all([restarting, surface]);
  expect(ExploreRuntime).toHaveBeenCalledTimes(2);
  expect(old.stop).toHaveBeenCalledTimes(1);
});

describe('cross-device favorite hydration', () => {
  beforeEach(() => {
    jest.mocked(needsFavoriteMetadata).mockImplementation(app => app.kind !== 'website' && !app.manifest);
  });

it('hydrates a cross-device favorite in the background so its icon can download locally', async () => {
  exploreService.deactivate();
  jest.useFakeTimers();
  const app = { ...entry('napp'), desktopPosition: 0 };
  const sibling = { ...website, desktopPosition: 1 };
  let finish!: (app: ExploreEntry) => void;
  jest.mocked(readFavoriteEntries).mockResolvedValueOnce([app, sibling]);
  jest.mocked(resolveFavoriteMetadata).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  try {
    await exploreService.activate('account');
    expect(exploreStore.getState()).toMatchObject({ loaded: true, entries: [app, sibling] });
    expect(resolveFavoriteMetadata).not.toHaveBeenCalled();
    await jest.advanceTimersByTimeAsync(0);
    expect(resolveFavoriteMetadata).toHaveBeenCalledWith('account', app, expect.any(AbortSignal));
    const unchanged = exploreStore.getState().entries[1];
    finish({ ...app, title: 'Remote app', icon: { hash: 'f'.repeat(64), mime: 'image/png' }, servers: ['https://media.example/'],
      manifest: { id: 'b'.repeat(64), kind: 35130, pubkey: 'a'.repeat(64), created_at: 1,
        content: '', tags: [['d', 'test']], sig: 'c'.repeat(128) } });
    await jest.advanceTimersByTimeAsync(0);
    expect(exploreStore.getState().entries[0]).toMatchObject({ title: 'Remote app', icon: { hash: 'f'.repeat(64) }, desktopPosition: 0, lastUsedAt: null });
    expect(exploreStore.getState().entries[1]).toBe(unchanged);
    expect(nappletService.activateAccount).not.toHaveBeenCalled();
    expect(queueFavoritesPublication).not.toHaveBeenCalled();
    expect(visit).not.toHaveBeenCalled();
  } finally { jest.useRealTimers(); }
});

it('hydrates newly synced references while Favorites is already open', async () => {
  jest.useFakeTimers();
  const app = { ...entry('napp'), desktopPosition: 0 };
  jest.mocked(readFavoriteReferences).mockResolvedValueOnce([app]);
  try {
    notifyFavoritesChanged('account');
    await jest.advanceTimersByTimeAsync(0);
    expect(resolveFavoriteMetadata).toHaveBeenCalledWith('account', app, expect.any(AbortSignal));
    expect(exploreStore.getState().entries).toEqual([app]);
    expect(queueFavoritesPublication).not.toHaveBeenCalled();
  } finally { jest.useRealTimers(); }
});

it('limits remote hydration to four workers and to requested favorite pages', async () => {
  exploreService.deactivate();
  jest.useFakeTimers();
  const favorites = Array.from({ length: 55 }, (_, index) => ({ ...entry('napp'), key: `remote-${index}`, desktopPosition: index }));
  const finish: ((app: ExploreEntry) => void)[] = [];
  jest.mocked(readFavoriteEntries).mockResolvedValueOnce(favorites);
  jest.mocked(resolveFavoriteMetadata).mockImplementation(() => new Promise(resolve => { finish.push(resolve); }));
  try {
    await exploreService.activate('account');
    await jest.advanceTimersByTimeAsync(0);
    expect(resolveFavoriteMetadata).toHaveBeenCalledTimes(4);
    await exploreService.loadMoreFavorites('account');
    expect(exploreStore.getState().favoriteVisibleCount).toBe(55);
    expect(resolveFavoriteMetadata).toHaveBeenCalledTimes(4);
    finish[0](favorites[0]);
    await jest.advanceTimersByTimeAsync(0);
    expect(resolveFavoriteMetadata).toHaveBeenCalledTimes(5);
    expect(jest.mocked(resolveFavoriteMetadata).mock.calls[4][1].key).toBe('remote-4');
  } finally { jest.useRealTimers(); }
});

it('rebuilds queued hydration for the first page on revisit while retaining active workers', async () => {
  exploreService.deactivate();
  jest.useFakeTimers();
  const favorites = Array.from({ length: 55 }, (_, index) => ({ ...entry('napp'), key: `remote-${index}`, desktopPosition: index }));
  const active = new Map<string, () => void>();
  jest.mocked(readFavoriteEntries).mockResolvedValueOnce(favorites);
  jest.mocked(resolveFavoriteMetadata).mockImplementation((_account, app) => new Promise(resolve => {
    active.set(app.key, () => { active.delete(app.key); resolve(app); });
  }));
  try {
    await exploreService.activate('account');
    await jest.advanceTimersByTimeAsync(0);
    await exploreService.loadMoreFavorites('account');
    expect(active.size).toBe(4);
    const added = { ...entry('napp'), key: 'new-first', desktopPosition: 0 };
    const refreshed = [added, ...favorites.filter(app => app.key !== 'remote-4')]
      .map((app, index) => ({ ...app, desktopPosition: index }));
    let finishRead!: (entries: ExploreEntry[]) => void;
    jest.mocked(readFavoriteEntries).mockImplementationOnce(() => new Promise(resolve => { finishRead = resolve; }));
    const refresh = exploreService.activate('account', { refresh: true });
    active.get('remote-0')!();
    await jest.advanceTimersByTimeAsync(0);
    // No queued old-page work starts while the replacement snapshot is still loading.
    expect(resolveFavoriteMetadata).toHaveBeenCalledTimes(4);
    finishRead(refreshed);
    await refresh;
    await jest.advanceTimersByTimeAsync(0);
    expect(exploreStore.getState().favoriteVisibleCount).toBe(50);
    expect(jest.mocked(resolveFavoriteMetadata).mock.calls[4][1].key).toBe('new-first');
    expect(active.size).toBe(4);
    while (active.size) {
      active.values().next().value!();
      await jest.advanceTimersByTimeAsync(0);
      expect(active.size).toBeLessThanOrEqual(4);
    }
    const requested = jest.mocked(resolveFavoriteMetadata).mock.calls.map(call => call[1].key);
    expect(requested).not.toContain('remote-4');
    for (let index = 50; index < 55; index++) expect(requested).not.toContain(`remote-${index}`);
    for (const key of ['remote-1', 'remote-2', 'remote-3']) expect(requested.filter(value => value === key)).toHaveLength(1);
  } finally { jest.useRealTimers(); }
});

it('ignores delayed pagination hydration from the previous Favorites visit', async () => {
  exploreService.deactivate();
  jest.useFakeTimers();
  const favorites = Array.from({ length: 55 }, (_, index) => ({ ...entry(index < 50 ? 'website' : 'napp'), key: `saved-${index}`, desktopPosition: index }));
  jest.mocked(readFavoriteEntries).mockResolvedValueOnce(favorites).mockResolvedValueOnce(favorites);
  let finish!: (entries: ExploreEntry[]) => void;
  try {
    await exploreService.activate('account');
    await jest.advanceTimersByTimeAsync(0);
    jest.mocked(readFavoriteMetadata).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const more = exploreService.loadMoreFavorites('account');
    await exploreService.activate('account', { refresh: true });
    await jest.advanceTimersByTimeAsync(0);
    finish(favorites.slice(50));
    await more;
    await jest.advanceTimersByTimeAsync(0);
    expect(exploreStore.getState().favoriteVisibleCount).toBe(50);
    expect(resolveFavoriteMetadata).not.toHaveBeenCalled();
  } finally { jest.useRealTimers(); }
});

it('does not fetch offscreen manifests just to search saved favorites', async () => {
  exploreService.deactivate();
  jest.useFakeTimers();
  const favorites = Array.from({ length: 55 }, (_, index) => index < 50
    ? { ...website, key: `website-${index}`, desktopPosition: index }
    : { ...entry('napp'), key: `remote-${index}`, desktopPosition: index });
  jest.mocked(readFavoriteEntries).mockResolvedValueOnce(favorites);
  try {
    await exploreService.activate('account');
    await jest.advanceTimersByTimeAsync(0);
    await exploreService.loadFavoriteSearchMetadata('account');
    expect(resolveFavoriteMetadata).not.toHaveBeenCalled();
    await exploreService.loadMoreFavorites('account');
    expect(resolveFavoriteMetadata).toHaveBeenCalledTimes(5);
  } finally { jest.useRealTimers(); }
});

it('retries unavailable cross-device metadata on the next Favorites visit', async () => {
  exploreService.deactivate();
  jest.useFakeTimers();
  const app = { ...entry('napp'), desktopPosition: 0 };
  jest.mocked(readFavoriteEntries).mockResolvedValue([app]);
  jest.mocked(resolveFavoriteMetadata).mockRejectedValue(new Error('offline'));
  try {
    await exploreService.activate('account');
    await jest.advanceTimersByTimeAsync(0);
    expect(exploreStore.getState().entries).toEqual([app]);
    expect(resolveFavoriteMetadata).toHaveBeenCalledTimes(1);
    await exploreService.activate('account', { refresh: true });
    await jest.advanceTimersByTimeAsync(0);
    expect(resolveFavoriteMetadata).toHaveBeenCalledTimes(2);
  } finally {
    jest.mocked(readFavoriteEntries).mockResolvedValue([]);
    jest.useRealTimers();
  }
});

it('cancels queued hydration on account replacement and ignores delayed old results', async () => {
  exploreService.deactivate();
  jest.useFakeTimers();
  const favorites = Array.from({ length: 5 }, (_, index) => ({ ...entry('napp'), key: `old-${index}`, desktopPosition: index }));
  let finish!: (app: ExploreEntry) => void;
  jest.mocked(readFavoriteEntries).mockResolvedValueOnce(favorites);
  jest.mocked(resolveFavoriteMetadata).mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  try {
    await exploreService.activate('account');
    await jest.advanceTimersByTimeAsync(0);
    const signal = jest.mocked(resolveFavoriteMetadata).mock.calls[0][2];
    expect(resolveFavoriteMetadata).toHaveBeenCalledTimes(4);
    await exploreService.activate('other-account');
    expect(signal.aborted).toBe(true);
    finish({ ...favorites[3], title: 'Old account' });
    await jest.advanceTimersByTimeAsync(0);
    expect(exploreStore.getState()).toMatchObject({ account: 'other-account', entries: [] });
    expect(resolveFavoriteMetadata).toHaveBeenCalledTimes(4);
  } finally { jest.useRealTimers(); }
});

});
