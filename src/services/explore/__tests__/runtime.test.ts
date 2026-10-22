import { ExploreRuntime } from '../runtime';
import { platform } from '@/platform';
import { NappletNetwork } from '@/services/napplet/network';
import { memoryRepository, rules } from '@/services/signing/testing/memory-repository';
import { invalidateSigning } from '@/services/signing/changes';
import type { ExploreEntry } from '../model';
import { loadSiteBlob } from '@/services/napplet/artifacts';
import { getData } from '@/services/napplet/repository';
jest.mock('@/i18n/core', () => ({ __esModule: true, default: { t: (key: string) => key } }));
jest.mock('../browser-permission-store', () => ({ readBrowserPermissions: jest.fn(async () => []), saveBrowserPermissions: jest.fn(async () => {}) }));
jest.mock('@/services/signing/repository', () => jest.requireActual('../../signing/testing/memory-repository').memoryRepository);
jest.mock('@/services/local-relay', () => ({ localRelay: { add: jest.fn(async () => true), query: jest.fn(async () => [{id:'event'}]), count: jest.fn(async () => 1), event: jest.fn(async()=>undefined), replaceable: jest.fn(async()=>undefined), subscribe: jest.fn(()=>()=>{}), remove: jest.fn(async()=>[]) } }));
jest.mock('@/services/napplet/repository',()=>({getData:jest.fn(async()=>null),setData:jest.fn(async()=>{})}));
jest.mock('@/services/napplet/artifacts', () => ({ fetchBlob: jest.fn(), loadSiteBlob: jest.fn(), recordArtifactVersion: jest.fn(async () => {}) }));
jest.mock('@/platform', () => ({ platform: { napplet: { openPage: jest.fn(async () => 'container'), close: jest.fn(async () => { }), send: jest.fn(async () => { }), addMessageListener: jest.fn(() => () => { }) } } }));
jest.mock('@/services/napplet/network', () => ({ NappletNetwork: jest.fn().mockImplementation(() => ({ destroy: jest.fn(), sign: jest.fn(async (event) => ({ ...event, pubkey: 'account' })) })) }));
const entry: ExploreEntry = { key: 'https://site.example/path', address: 'https://site.example/path', title: 'Site', kind: 'website', description: '', servers: [], required: [], desktopPosition: null, lastUsedAt: null };
let receive: (id: string, raw: string) => void;
const flush = () => new Promise<void>(r => setTimeout(r, 0));
let runtime: ExploreRuntime;
let confirm: jest.Mock;
let debugLog: jest.SpyInstance;
let warningLog: jest.SpyInstance;
function message(origin: string, document: string, method = 'signEvent', id = '1') {
  receive('container', JSON.stringify({ type: 'explore.request', origin, document, raw: JSON.stringify({ id, nonce:'test-document', method, args: method === 'signEvent' ? [{ kind: 1, content: 'hello', tags: [], created_at: 1 }] : [] }) }));
}
beforeEach(async () => {
  jest.clearAllMocks();
  debugLog = jest.spyOn(console, 'debug').mockImplementation(() => {});
  warningLog = jest.spyOn(console, 'warn').mockImplementation(() => {});
  rules.clear();
  jest.mocked(getData).mockResolvedValue(null);
  (platform.napplet.addMessageListener as jest.Mock).mockImplementation(fn => { receive = fn; return () => { }; });
  confirm = jest.fn(async () => 'allow-always');
  runtime = new ExploreRuntime('account', entry, { confirm, close: () => { }, link: () => { } });
  await runtime.start();
});
afterEach(async () => { await runtime.stop(); debugLog.mockRestore(); warningLog.mockRestore(); });

it('waits for native container cleanup and shares repeated stop calls', async () => {
  let closed!: () => void;
  jest.mocked(platform.napplet.close).mockImplementationOnce(() => new Promise<void>(resolve => { closed = resolve; }));
  const stopping = runtime.stop();
  expect(runtime.stop()).toBe(stopping);
  let finished = false;
  void stopping.then(() => { finished = true; });
  await Promise.resolve();
  expect(finished).toBe(false);
  expect(platform.napplet.close).toHaveBeenCalledTimes(1);
  closed(); await stopping;
});

it('waits for a container still opening to be closed before cleanup completes', async () => {
  await runtime.stop();
  jest.mocked(platform.napplet.close).mockClear();
  let opened!: (id: string) => void;
  jest.mocked(platform.napplet.openPage!).mockImplementationOnce(() => new Promise<string>(resolve => { opened = resolve; }));
  runtime = new ExploreRuntime('account', entry, { confirm, close: () => {}, link: () => {} });
  const starting = runtime.start();
  const canceled = expect(starting).rejects.toThrow('session-closed');
  const stopping = runtime.stop();
  let finished = false;
  void stopping.then(() => { finished = true; });
  await Promise.resolve();
  expect(finished).toBe(false);
  opened('late-container');
  await Promise.all([stopping, canceled]);
  expect(platform.napplet.close).toHaveBeenCalledTimes(1);
  expect(platform.napplet.close).toHaveBeenCalledWith('late-container');
});
it('shares remembered decisions on one origin and separates scheme, subdomain and port', async () => {
  message('https://site.example', 'one');
  await flush();
  expect(confirm).toHaveBeenCalledTimes(1);
  message('https://site.example', 'two');
  await flush();
  expect(confirm).toHaveBeenCalledTimes(1);
  message('https://site.example:8443', 'three');
  await flush();
  message('http://site.example', 'four');
  await flush();
  message('https://sub.site.example', 'five');
  await flush();
  expect(confirm).toHaveBeenCalledTimes(4);
});
it('discards an approval when its document navigates away', async () => {
  let answer!: (value: string) => void;
  confirm.mockImplementation(() => new Promise(resolve => { answer = resolve; }));
  message('https://site.example', 'one');
  await flush();
  receive('container', JSON.stringify({ type: 'explore.navigation', origin: 'https://other.example', document: 'two' }));
  answer('allow');
  await flush();
  expect(platform.napplet.send).not.toHaveBeenCalled();
  const network = (NappletNetwork as jest.Mock).mock.results.at(-1)!.value;
  expect(network.sign).not.toHaveBeenCalled();
});
it('does not return a signature revoked while the signer was working', async () => {
  let finish!: (value: unknown) => void;
  const network = (NappletNetwork as jest.Mock).mock.results.at(-1)!.value;
  network.sign.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  message('https://site.example', 'one');
  await flush();
  invalidateSigning({ accountPubkey: 'account', sourceId: 'https://site.example' });
  finish({ sig: 'late' });
  await flush();
  const response = JSON.parse((platform.napplet.send as jest.Mock).mock.calls.at(-1)![1]);
  expect(response.reply.error).toBe('permission-revoked');
  expect(response.reply.result).toBeUndefined();
});
it.each(['getPublicKey', 'signEvent'])('returns a denied %s request without logging a warning', async method => {
  confirm.mockResolvedValue(false);
  message('https://site.example', 'one', method);
  await flush();
  expect(confirm).toHaveBeenCalled();
  expect(JSON.parse((platform.napplet.send as jest.Mock).mock.calls.at(-1)![1]).reply.error).toBe('permission-denied');
  expect(warningLog).not.toHaveBeenCalled();
  expect((NappletNetwork as jest.Mock).mock.results.at(-1)!.value.sign).not.toHaveBeenCalled();
});

it('still warns when an approved signing operation fails', async () => {
  (NappletNetwork as jest.Mock).mock.results.at(-1)!.value.sign.mockRejectedValueOnce(new Error('signer-unavailable'));
  message('https://site.example', 'one');
  await flush();
  expect(warningLog).toHaveBeenCalledWith('[explore]', 'Site', 'signEvent', { error: 'signer-unavailable' });
  expect(JSON.parse((platform.napplet.send as jest.Mock).mock.calls.at(-1)![1]).reply.error).toBe('signer-unavailable');
});

it('returns a denied browser window request without logging a warning', async () => {
  confirm.mockResolvedValue(false);
  receive('container', JSON.stringify({ type: 'explore.browser', origin: 'https://site.example', document: 'one',
    browser: { action: 'window', id: 'denied-window', url: 'https://other.example/' } }));
  await flush();
  expect(confirm).toHaveBeenCalled();
  expect(warningLog).not.toHaveBeenCalled();
  expect(JSON.parse((platform.napplet.send as jest.Mock).mock.calls.at(-1)![1]).reply)
    .toMatchObject({ type: 'browser.result', id: 'denied-window', result: false });
});
it('allows a napp without identity requirements to request account access and signing', async () => {
  await runtime.stop();
  const napp: ExploreEntry = { ...entry, key: 'naddr-test', kind: 'napp', required: [], files: [] };
  runtime = new ExploreRuntime('account', napp, { confirm, close: () => {}, link: () => {} });
  await runtime.start();
  confirm.mockResolvedValue('allow');
  message('https://app.explore.psstpsst.invalid', 'one', 'getPublicKey');
  await flush();
  expect(confirm).toHaveBeenCalledTimes(1);
  expect(JSON.parse((platform.napplet.send as jest.Mock).mock.calls.at(-1)![1]).reply.result).toBe('account');
  message('https://app.explore.psstpsst.invalid', 'one', 'signEvent', '2');
  await flush();
  expect(confirm).toHaveBeenCalledTimes(2);
  expect(JSON.parse((platform.napplet.send as jest.Mock).mock.calls.at(-1)![1]).reply.result.kind).toBe(1);
});
it('still denies account access for a napp when consent is refused', async () => {
  await runtime.stop();
  runtime = new ExploreRuntime('account', { ...entry, kind: 'napp', required: [], files: [] }, { confirm, close: () => {}, link: () => {} });
  await runtime.start();
  confirm.mockResolvedValue(false);
  message('https://app.explore.psstpsst.invalid', 'one', 'getPublicKey');
  await flush();
  expect(confirm).toHaveBeenCalledTimes(1);
  expect(JSON.parse((platform.napplet.send as jest.Mock).mock.calls.at(-1)![1]).reply.error).toBe('permission-denied');
});
it('clears live remembered authority through the shared repository', async () => {
  message('https://site.example', 'one');
  await flush();
  await memoryRepository.clearSigningPermissions({ accountPubkey: 'account', sourceId: 'https://site.example' });
  message('https://site.example', 'one', 'signEvent', '2');
  await flush();
  expect(confirm).toHaveBeenCalledTimes(2);
});

it('reviews a well-formed relay AUTH event for its destination',async()=>{
  const event={kind:22242,content:'',created_at:1,tags:[['relay','wss://relay.example/'],['challenge','server-challenge']]};
  receive('container',JSON.stringify({type:'explore.request',origin:'https://site.example',document:'one',raw:JSON.stringify({id:'auth',nonce:'test-document',method:'signEvent',args:[event]})}));
  await flush();expect(confirm).toHaveBeenCalledWith(expect.objectContaining({signing:expect.objectContaining({operation:'relay-auth',relays:['wss://relay.example/']})}),expect.any(AbortSignal));
  expect(JSON.parse((platform.napplet.send as jest.Mock).mock.calls.at(-1)![1]).reply.result.kind).toBe(22242);
});

it('reads public profiles and relay lists without declared capabilities', async () => {
  await runtime.stop();
  runtime = new ExploreRuntime('account', { ...entry, kind: 'napp', required: [], files: [] }, { confirm, close: () => {}, link: () => {} });
  await runtime.start();
  const network = (NappletNetwork as jest.Mock).mock.results.at(-1)!.value;
  network.replaceable = jest.fn(async (_pubkey, kind) => kind === 0
    ? { content: JSON.stringify({ name: 'Cody' }) }
    : { tags: [['r', 'wss://relay.example', 'read'], ['r', 'wss://relay.example/', 'write'], ['r', 'https://invalid.example']] });
  const pubkey = 'a'.repeat(64);
  const request = async (method: string, args: unknown[]) => {
    receive('container', JSON.stringify({ type: 'explore.request', origin: 'https://app.example', document: 'one',
      raw: JSON.stringify({ id: method, nonce: 'test-document', method, args }) }));
    await flush();
    return JSON.parse((platform.napplet.send as jest.Mock).mock.calls.at(-1)![1]).reply;
  };
  expect((await request('profile', [{ pubkey }])).result).toMatchObject({ pubkey, shortName: 'Cody', metadata: { name: 'Cody' } });
  expect((await request('relayList', [pubkey])).result.items).toEqual([{ url: 'wss://relay.example/', read: true, write: true }]);
  network.routes = jest.fn(async () => ['wss://relay.example/']);
  network.query = jest.fn(async () => ({ events: [{ id: 'event' }] }));
  expect((await request('query', [[{ kinds: [1], limit: 10 }]])).result).toEqual([{ id: 'event' }]);
  expect((await request('count', [[{ kinds: [1], limit: 10 }]])).result).toBe(1);
  expect((await request('profile', ['invalid'])).error).toBe('invalid-pubkey');
  expect((await request('publish', [{}])).error).toBe('permission-denied');
  expect(confirm).not.toHaveBeenCalled();
});

it('reviews public-key access separately from launch consent and isolates origins',async()=>{
  await runtime.stop();
  runtime=new ExploreRuntime('account',entry,{confirm,close:()=>{},link:()=>{}});
  await runtime.start();
  message('https://site.example','one','getPublicKey');await flush();
  expect(confirm).toHaveBeenCalledWith(expect.objectContaining({signing:expect.objectContaining({operation:'get-public-key'}),requester:{title:'site.example',origin:'https://site.example'}}),expect.anything());
  confirm.mockResolvedValue('allow');
  message('https://other.example','two','getPublicKey','2');await flush();
  expect(confirm).toHaveBeenCalledWith(expect.objectContaining({application:expect.objectContaining({title:'other.example'}),requester:{title:'other.example',origin:'https://other.example'}}),expect.anything());
});

it.each([{servers:[]},{servers:['https://old.example/']}])('shares one author-server fallback across missing nsite files: %j',async({servers})=>{
  await runtime.stop();
  const app={...entry,kind:'nsite' as const,servers,manifest:{pubkey:'b'.repeat(64)} as import('nostr-tools').Event,
    files:[{path:'/index.html',hash:'a'.repeat(64),mime:'text/html'},{path:'/app.js',hash:'c'.repeat(64),mime:'text/javascript'}]};
  runtime=new ExploreRuntime('account',app,{confirm,close:()=>{},link:()=>{}});
  const network=(NappletNetwork as jest.Mock).mock.results.at(-1)!.value;
  network.mediaServers=jest.fn(async()=>['https://old.example/','https://new.example/']);
  jest.mocked(loadSiteBlob).mockImplementation(async(source)=>{
    if(!source.servers.includes('https://new.example/'))throw new Error('napplets.download_failed');
    return new TextEncoder().encode('file');
  });
  await runtime.start();
  expect(network.mediaServers).toHaveBeenCalledTimes(1);
  expect(network.mediaServers).toHaveBeenCalledWith(app.manifest.pubkey,expect.any(AbortSignal));
  expect(loadSiteBlob).toHaveBeenCalledWith({...app,servers:['https://old.example/','https://new.example/'].filter(server=>!servers.includes(server))},'a'.repeat(64),expect.any(AbortSignal));
  expect(platform.napplet.openPage).toHaveBeenLastCalledWith(expect.objectContaining({files:expect.arrayContaining([expect.objectContaining({path:'/index.html'}),expect.objectContaining({path:'/app.js'})])}));
});

it('does not open a nsite after cancellation while author servers are loading',async()=>{
  await runtime.stop();jest.mocked(platform.napplet.openPage!).mockClear();
  const app={...entry,kind:'nsite' as const,manifest:{pubkey:'b'.repeat(64)} as import('nostr-tools').Event,
    files:[{path:'/index.html',hash:'a'.repeat(64),mime:'text/html'}]};
  runtime=new ExploreRuntime('account',app,{confirm,close:()=>{},link:()=>{}});
  const network=(NappletNetwork as jest.Mock).mock.results.at(-1)!.value;
  let finish!:(servers:string[])=>void;
  let started!:()=>void;
  const loading=new Promise<void>(resolve=>{started=resolve;});
  network.mediaServers=jest.fn(()=>new Promise(resolve=>{finish=resolve;started();}));
  jest.mocked(loadSiteBlob).mockRejectedValue(new Error('napplets.download_failed'));
  const start=runtime.start();
  const cancelled=expect(start).rejects.toThrow();
  await loading;
  expect(network.mediaServers).toHaveBeenCalledTimes(1);
  await runtime.stop();finish(['https://new.example/']);
  await cancelled;
  expect(platform.napplet.openPage).not.toHaveBeenCalled();
});
