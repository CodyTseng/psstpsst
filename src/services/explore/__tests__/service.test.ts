import { exploreService,exploreStore } from '../service';
import { nappletService } from '@/services/napplet/service';
import { getData,setData } from '@/services/napplet/repository';
import { readEntries, reorder, visit } from '../repository';
import { ExploreRuntime } from '../runtime';
import type { ExploreEntry } from '../model';
import { naddrEncode } from 'nostr-tools/nip19';
jest.mock('@/platform',()=>({platform:{urlOpener:{openExternalUrl:jest.fn()}}}));
jest.mock('@/services/napplet/service',()=>({nappletService:{activate:jest.fn(async()=>{}),stop:jest.fn(),requestApproval:jest.fn(async()=> 'allow'),currentTheme:()=>undefined}}));
jest.mock('@/services/napplet/network',()=>({NappletNetwork:jest.fn()}));
jest.mock('@/services/napplet/lifecycle',()=>({registerNappletLifecycle:jest.fn(),registerNappletVisit:jest.fn(),registerNappletTheme:jest.fn()}));
jest.mock('@/services/signing/repository',()=>({clearSigningPermissions:jest.fn(async()=>{})}));
jest.mock('@/services/napplet/repository',()=>({getData:jest.fn(async()=>null),setData:jest.fn(async()=>{})}));
jest.mock('../repository',()=>({readEntries:jest.fn(async()=>[]),visit:jest.fn(async()=>{}),fromNapplet:jest.fn(),reorder:jest.fn(),forget:jest.fn()}));
jest.mock('../runtime',()=>({ExploreRuntime:jest.fn().mockImplementation(()=>({start:jest.fn(async()=> 'container'),stop:jest.fn(),presented:true}))}));
const website:ExploreEntry={key:'https://site.example/path',address:'https://site.example/path',title:'Site',kind:'website',required:[],description:'',servers:[],lastUsedAt:null,desktopPosition:null};
function entry(kind:'website'|'nsite'|'napp'):ExploreEntry {
  if(kind==='website')return website;
  const key=naddrEncode({kind:kind==='napp'?35130:35128,pubkey:'a'.repeat(64),identifier:'test'});
  return {...website,kind,key,address:key};
}
beforeEach(async()=>{jest.clearAllMocks();jest.mocked(getData).mockResolvedValue(null);jest.mocked(nappletService.requestApproval).mockResolvedValue('allow');await exploreService.activate('account');});
afterEach(()=>exploreService.deactivate());
it.each(['website','nsite','napp'] as const)('uses one first-use approval and remembered account access for %s',async kind=>{
  const app=entry(kind),runId=exploreService.prepare(app,'account');
  await exploreService.start(runId);
  expect(nappletService.requestApproval).toHaveBeenCalledWith(expect.objectContaining({application:expect.objectContaining({title:'Site'}),accountPubkey:'account'}),expect.anything());
  expect(setData).toHaveBeenCalledWith({accountPubkey:'account',appKey:exploreService.signingSource(app)},'permissions','domains','[]');
  expect(ExploreRuntime).toHaveBeenCalledWith('account',app,expect.objectContaining({confirm:nappletService.requestApproval}));
  jest.mocked(nappletService.requestApproval).mockClear();jest.mocked(getData).mockResolvedValue('[]');
  const again=exploreService.prepare(app,'account');await exploreService.start(again);
  expect(nappletService.requestApproval).not.toHaveBeenCalled();
});
it('does not open a container when first-use approval is refused',async()=>{
  jest.mocked(nappletService.requestApproval).mockResolvedValue(false);
  const id=exploreService.prepare(website,'account');await exploreService.start(id);
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
  const app={...entry('napp'),required:['relay']};
  const id=exploreService.prepare(app,'account',['relay']);await exploreService.start(id);
  expect(nappletService.requestApproval).not.toHaveBeenCalled();
  expect(setData).toHaveBeenCalledWith(expect.anything(),'permissions','domains','["relay"]');
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
