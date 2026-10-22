import { notifyFavoritesChanged } from '../favorites-events';
import { exploreService,exploreStore } from '../service';
import { applicationTasks, applicationTaskStore } from '../application-tasks';
import { nappletService } from '@/services/napplet/service';
import { getData,setData } from '@/services/napplet/repository';
import { readEntries, reorder, visit } from '../repository';
import { ExploreRuntime } from '../runtime';
import type { ExploreEntry } from '../model';
import { naddrEncode } from 'nostr-tools/nip19';
import { tryOpenApplicationWindow } from '../windows';
import { platform } from '@/platform';
jest.mock('../application-metadata', () => ({ refreshApplicationMetadata: jest.fn(async () => {}), subscribeApplicationMetadata: jest.fn() }));
jest.mock('@/services/relay/replaceable-events.service', () => ({ invalidateReplaceableEvents: jest.fn() }));
jest.mock('../browser-permission-store', () => ({ clearBrowserPermissions: jest.fn(async () => {}) }));
jest.mock('@/platform',()=>({platform:{urlOpener:{openExternalUrl:jest.fn()},napplet:{tasks:{open:jest.fn(async()=>{}),focus:jest.fn(async()=>{}),close:jest.fn(async()=>{}),onClosed:jest.fn()}}}}));
jest.mock('@/services/account/account-receive-guard',()=>({canReceiveForAccount:jest.fn(async()=>true)}));
jest.mock('@/services/napplet/artifacts',()=>({loadArtifact:jest.fn()}));
jest.mock('@/services/napplet/runtime',()=>({NappletRuntime:jest.fn()}));
jest.mock('@/services/napplet/service',()=>({nappletStore:{getState:()=>({accountPubkey:'account'})},nappletService:{activate:jest.fn(async()=>{}),activateAccount:jest.fn(async()=>{}),stop:jest.fn(),requestApproval:jest.fn(async()=> 'allow'),currentTheme:()=>undefined}}));
jest.mock('@/services/napplet/network',()=>({NappletNetwork:jest.fn()}));
jest.mock('@/services/napplet/lifecycle',()=>({registerNappletLifecycle:jest.fn(),registerNappletVisit:jest.fn(),registerNappletTheme:jest.fn(),registerNappletSourceInvalidation:jest.fn()}));
jest.mock('@/services/signing/repository',()=>({clearSigningPermissions:jest.fn(async()=>{})}));
jest.mock('@/services/napplet/repository',()=>({getData:jest.fn(async()=>null),setData:jest.fn(async()=>{})}));
jest.mock('../favorite-metadata', () => ({ needsFavoriteMetadata: () => false, resolveFavoriteMetadata: async (_account: string, entry: unknown) => entry }));
jest.mock('../repository',()=>({queueFavoritesPublication:jest.fn(),readEntries:jest.fn(async()=>[]),visit:jest.fn(async()=>{}),fromNapplet:jest.fn(),reorder:jest.fn(),forget:jest.fn()}));
jest.mock('../runtime',()=>({ExploreRuntime:jest.fn().mockImplementation(function(this: object){Object.assign(this,{start:jest.fn(async()=> 'container'),stop:jest.fn(),presented:true});})}));
const website:ExploreEntry={key:'https://site.example/path',address:'https://site.example/path',title:'Site',kind:'website',required:[],description:'',servers:[],lastUsedAt:null,desktopPosition:null};
function entry(kind:'website'|'nsite'|'napp'):ExploreEntry {
  if(kind==='website')return website;
  const key=naddrEncode({kind:kind==='napp'?35130:35128,pubkey:'a'.repeat(64),identifier:'test'});
  return {...website,kind,key,address:key};
}
beforeEach(async()=>{jest.clearAllMocks();jest.mocked(getData).mockResolvedValue(null);jest.mocked(nappletService.requestApproval).mockResolvedValue('allow');await exploreService.activate('account');});
afterEach(async()=>{exploreService.deactivate();for(const id of applicationTaskStore.getState().sessions.keys())await applicationTasks.close(id);});
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

it('refreshes one committed window visit without overwriting an optimistic desktop position', async () => {
  exploreStore.setState({ entries: [{ ...website, desktopPosition: 3, lastUsedAt: 100 }] });
  jest.mocked(readEntries).mockResolvedValueOnce([{ ...website, desktopPosition: 0, lastUsedAt: 200 }]);
  await exploreService.refreshVisit('account', website.key);
  expect(readEntries).toHaveBeenLastCalledWith('account', website.key);
  expect(exploreStore.getState().entries[0]).toMatchObject({ desktopPosition: 3, lastUsedAt: 200 });
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

it('refreshes remote favorite order and applies metadata completion without overwriting it', async () => {
  exploreStore.setState({ entries: [{ ...website, desktopPosition: 3, lastUsedAt: 10 }] });
  jest.mocked(readEntries).mockResolvedValueOnce([{ ...website, desktopPosition: 0, lastUsedAt: 10 }]);
  notifyFavoritesChanged('account');
  for (let i = 0; i < 20; i++) await Promise.resolve();
  expect(exploreStore.getState().entries[0].desktopPosition).toBe(0);
  jest.mocked(readEntries).mockResolvedValueOnce([{ ...website, title: 'Resolved', desktopPosition: 4, lastUsedAt: 99 }]);
  notifyFavoritesChanged('account', website.key);
  for (let i = 0; i < 20; i++) await Promise.resolve();
  expect(readEntries).toHaveBeenLastCalledWith('account', website.key);
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

it('shares unfinished Favorites initialization across overlapping page opens', async () => {
  exploreService.deactivate();
  jest.mocked(nappletService.activateAccount).mockClear();
  jest.mocked(readEntries).mockClear();
  let ready!: () => void;
  jest.mocked(nappletService.activateAccount).mockImplementationOnce(() => new Promise<void>(resolve => { ready = resolve; }));
  const first = exploreService.activate('account');
  const second = exploreService.activate('account');
  expect(nappletService.activateAccount).toHaveBeenCalledTimes(1);
  expect(readEntries).toHaveBeenCalledTimes(1);
  expect(exploreStore.getState().loaded).toBe(false);
  ready();
  await Promise.all([first, second]);
  expect(readEntries).toHaveBeenCalledTimes(1);
  expect(exploreStore.getState()).toMatchObject({ account: 'account', loaded: true });
});


it('retains the loaded Favorites snapshot when reopening the same account', async () => {
  jest.mocked(nappletService.activateAccount).mockClear();
  jest.mocked(readEntries).mockClear();
  await exploreService.activate('account');
  await exploreService.activate('account');
  expect(readEntries).not.toHaveBeenCalled();
  expect(nappletService.activateAccount).not.toHaveBeenCalled();
});

it('allows another initialization attempt after a failed local Favorites read', async () => {
  exploreService.deactivate();
  jest.mocked(readEntries).mockClear();
  jest.mocked(readEntries).mockRejectedValueOnce(new Error('database-busy'));
  await expect(exploreService.activate('account')).rejects.toThrow('database-busy');
  await exploreService.activate('account');
  expect(readEntries).toHaveBeenCalledTimes(2);
  expect(exploreStore.getState().loaded).toBe(true);
});

it('does not let an old account load discard another account initialization', async () => {
  exploreService.deactivate();
  jest.mocked(nappletService.activateAccount).mockClear();
  let firstReady!: () => void, secondReady!: () => void;
  jest.mocked(nappletService.activateAccount)
    .mockImplementationOnce(() => new Promise<void>(resolve => { firstReady = resolve; }))
    .mockImplementationOnce(() => new Promise<void>(resolve => { secondReady = resolve; }));
  const first = exploreService.activate('first');
  const second = exploreService.activate('second');
  firstReady();
  await first;
  const repeated = exploreService.activate('second');
  expect(nappletService.activateAccount).toHaveBeenCalledTimes(2);
  secondReady();
  await Promise.all([second, repeated]);
  expect(exploreStore.getState()).toMatchObject({ account: 'second', loaded: true });
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
  expect(exploreStore.getState()).toMatchObject({ entry: { key: app.key, title: 'Updated', required: ['network'] }, containerId: null, error: 'napplets.request_failed' });
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
