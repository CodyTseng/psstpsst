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
jest.mock('../browser-permission-store', () => ({ clearBrowserPermissions: jest.fn(async () => {}) }));
jest.mock('@/platform',()=>({platform:{urlOpener:{openExternalUrl:jest.fn()},napplet:{tasks:{open:jest.fn(async()=>{}),focus:jest.fn(async()=>{}),close:jest.fn(async()=>{}),onClosed:jest.fn()}}}}));
jest.mock('@/services/account/account-receive-guard',()=>({canReceiveForAccount:jest.fn(async()=>true)}));
jest.mock('@/services/napplet/artifacts',()=>({loadArtifact:jest.fn()}));
jest.mock('@/services/napplet/runtime',()=>({NappletRuntime:jest.fn()}));
jest.mock('@/services/napplet/service',()=>({nappletStore:{getState:()=>({accountPubkey:'account'})},nappletService:{activate:jest.fn(async()=>{}),stop:jest.fn(),requestApproval:jest.fn(async()=> 'allow'),currentTheme:()=>undefined}}));
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
  expect(ExploreRuntime).toHaveBeenCalledWith('account',app,expect.objectContaining({confirm:nappletService.requestApproval}));
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
