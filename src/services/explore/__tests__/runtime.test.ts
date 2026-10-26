import { WebLn } from '../webln';
import { ExploreRuntime } from '../runtime';
import { platform } from '@/platform';
import { NappletNetwork } from '@/services/napplet/network';
import { memoryRepository, rules } from '@/services/signing/testing/memory-repository';
import { invalidateSigning } from '@/services/signing/changes';
import type { ExploreEntry } from '../model';
import { loadSiteBlob } from '@/services/napplet/artifacts';
import { getData } from '@/services/napplet/repository';
import { finalizeEvent, generateSecretKey } from 'nostr-tools';
jest.mock('../webln', () => ({ WebLn: jest.fn().mockImplementation(() => ({ handle: jest.fn(async () => true) })) }));
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
  receive('container', JSON.stringify({ type: 'explore.navigation', phase: 'commit', origin, document }));
  receive('container', JSON.stringify({ type: 'explore.request', origin, document, raw: JSON.stringify({ id, nonce:'test-document', method, args: method === 'signEvent' ? [{ kind: 1, content: 'hello', tags: [], created_at: 1 }] : [] }) }));
}

it('reviews and signs a complete large event without rewriting its timestamp or content', async () => {
  const event = { kind: 3, created_at: Math.floor(Date.now() / 1000) + 365 * 86400,
    content: 'x'.repeat(70000),
    tags: Array.from({ length: 1000 }, (_, index) => ['p', index.toString(16).padStart(64, '0')]) };
  receive('container', JSON.stringify({ type: 'explore.request', origin: 'https://site.example', document: 'one',
    raw: JSON.stringify({ id: 'large-event', nonce: 'test-document', method: 'signEvent', args: [event] }) }));
  await flush();
  expect(confirm).toHaveBeenCalledWith(expect.objectContaining({ signing: expect.objectContaining({
    kind: 3, content: event.content, tags: event.tags, createdAt: event.created_at,
  }) }), expect.any(AbortSignal));
  expect(jest.mocked(NappletNetwork).mock.results.at(-1)!.value.sign).toHaveBeenCalledWith(event);
});
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
  receive('container', JSON.stringify({ type: 'explore.navigation', phase: 'commit', origin: runtime.entry.kind === 'website' ? new URL(runtime.entry.address).origin : (runtime.entry.key === 'naddr-test' ? 'https://app.explore.psstpsst.invalid' : 'https://app.example'), document: 'one' }));
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
  expect(confirm).toHaveBeenCalledTimes(3);
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

it('returns a slow signature and retains the remembered decision', async () => {
  const clock = jest.spyOn(Date, 'now').mockReturnValue(1000);
  const network = jest.mocked(NappletNetwork).mock.results.at(-1)!.value;
  network.sign.mockImplementation(async () => { clock.mockReturnValue(61000); return { sig: 'slow' }; });
  try {
    message('https://site.example', 'one');
    await flush();
    expect(JSON.parse(jest.mocked(platform.napplet.send).mock.calls.at(-1)![1]).reply.result).toEqual({ sig: 'slow' });
    message('https://site.example', 'two');
    await flush();
    expect(confirm).toHaveBeenCalledTimes(1);
  } finally { clock.mockRestore(); }
});

it('verifies and publishes large signed events using the shared event structure', async () => {
  await runtime.stop();
  runtime = new ExploreRuntime('account', { ...entry, kind: 'napp', key: 'naddr-test', files: [], required: ['relay'] },
    { confirm, close: () => {}, link: () => {} });
  await runtime.start();
  receive('container', JSON.stringify({ type: 'explore.navigation', phase: 'commit', origin: runtime.entry.kind === 'website' ? new URL(runtime.entry.address).origin : (runtime.entry.key === 'naddr-test' ? 'https://app.explore.psstpsst.invalid' : 'https://app.example'), document: 'one' }));
  const event = finalizeEvent({ kind: 3, created_at: Math.floor(Date.now() / 1000) + 365 * 86400,
    content: 'x'.repeat(270000), tags: [
      ...Array.from({ length: 1000 }, (_, index) => ['p', index.toString(16).padStart(64, '0')]),
      ['custom', ...Array.from({ length: 32 }, () => 'x'.repeat(5000))],
    ] }, generateSecretKey());
  const network = jest.mocked(NappletNetwork).mock.results.at(-1)!.value;
  network.publish = jest.fn(async () => ({ 'wss://relay.example/': true }));
  for (const method of ['verifyEvent', 'publish']) {
    receive('container', JSON.stringify({ type: 'explore.request', origin: 'https://app.explore.psstpsst.invalid', document: 'one',
      raw: JSON.stringify({ id: method, nonce: 'test-document', method,
        args: method === 'publish' ? [event, ['wss://relay.example/']] : [event] }) }));
    await flush();
    const reply = JSON.parse(jest.mocked(platform.napplet.send).mock.calls.at(-1)![1]).reply;
    expect(reply.error).toBeUndefined();
    if (method === 'verifyEvent') expect(reply.result).toBe(true);
  }
  expect(network.publish).toHaveBeenCalledWith(event, ['wss://relay.example/']);
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
  receive('container', JSON.stringify({ type: 'explore.navigation', phase: 'commit', origin: runtime.entry.kind === 'website' ? new URL(runtime.entry.address).origin : (runtime.entry.key === 'naddr-test' ? 'https://app.explore.psstpsst.invalid' : 'https://app.example'), document: 'one' }));
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
  receive('container', JSON.stringify({ type: 'explore.navigation', phase: 'commit', origin: runtime.entry.kind === 'website' ? new URL(runtime.entry.address).origin : (runtime.entry.key === 'naddr-test' ? 'https://app.explore.psstpsst.invalid' : 'https://app.example'), document: 'one' }));
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
  receive('container', JSON.stringify({ type: 'explore.navigation', phase: 'commit', origin: runtime.entry.kind === 'website' ? new URL(runtime.entry.address).origin : (runtime.entry.key === 'naddr-test' ? 'https://app.explore.psstpsst.invalid' : 'https://app.example'), document: 'one' }));
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
  receive('container', JSON.stringify({ type: 'explore.navigation', phase: 'commit', origin: runtime.entry.kind === 'website' ? new URL(runtime.entry.address).origin : (runtime.entry.key === 'naddr-test' ? 'https://app.explore.psstpsst.invalid' : 'https://app.example'), document: 'one' }));
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
  receive('container', JSON.stringify({ type: 'explore.navigation', phase: 'commit', origin: runtime.entry.kind === 'website' ? new URL(runtime.entry.address).origin : (runtime.entry.key === 'naddr-test' ? 'https://app.explore.psstpsst.invalid' : 'https://app.example'), document: 'one' }));
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


it('binds WebLN to the host source and replaces its authority on navigation', async () => {
  message('https://site.example', 'one', 'webln.enable'); await flush();
  expect(JSON.parse(jest.mocked(platform.napplet.send).mock.calls.at(-1)![1]).reply.error).toBeUndefined();
  expect(WebLn).toHaveBeenCalledTimes(1);
  const first = jest.mocked(WebLn).mock.calls[0];
  expect(first.slice(0, 3)).toEqual(['account', 'https://site.example', 'site.example']);
  expect(first[3].aborted).toBe(false);
  message('https://other.example', 'two', 'webln.enable'); await flush();
  expect(first[3].aborted).toBe(true);
  expect(jest.mocked(WebLn).mock.calls[1][1]).toBe('https://other.example');
});
it('rejects wallet operations on insecure website origins', async () => {
  message('http://site.example', 'one', 'webln.enable'); await flush();
  expect(WebLn).not.toHaveBeenCalled();
  const raw = jest.mocked(platform.napplet.send).mock.calls.at(-1)![1];
  expect(JSON.parse(raw).reply.error).toBe('insecure-origin');
});

it('rejects stale requests throughout navigation and never restores authority from a request', async () => {
  const send = (origin: string, document: string) => receive('container', JSON.stringify({ type: 'explore.request', origin, document,
    raw: JSON.stringify({ id: 'stale', nonce: 'old-token', method: 'signEvent', args: [{ kind: 1, content: 'stale', tags: [], created_at: 1 }] }) }));
  receive('container', JSON.stringify({ type: 'explore.navigation', phase: 'start', origin: 'https://other.example', document: 'two' }));
  send('https://site.example', 'one');
  send('https://site.example', 'two');
  send('https://other.example', 'two');
  await flush();
  expect(confirm).not.toHaveBeenCalled();
  receive('container', JSON.stringify({ type: 'explore.navigation', phase: 'commit', origin: 'https://other.example', document: 'two' }));
  send('https://site.example', 'two');
  send('https://site.example', 'one');
  await flush();
  expect(confirm).not.toHaveBeenCalled();
  send('https://other.example', 'two');
  await flush();
  expect(confirm).toHaveBeenCalledTimes(1);
});

it('keeps HTTP websites browsable while rejecting every privileged method', async () => {
  receive('container', JSON.stringify({ type: 'explore.navigation', phase: 'commit', origin: 'http://site.example', document: 'http' }));
  for (const method of ['getPublicKey', 'signEvent', 'nip04.encrypt', 'nip04.decrypt', 'nip44.encrypt', 'nip44.decrypt', 'webln.enable', 'webln.sendPayment', 'clipboard.writeText']) {
    receive('container', JSON.stringify({ type: 'explore.request', origin: 'http://site.example', document: 'http',
      raw: JSON.stringify({ id: method, nonce: 'http-token', method, args: [] }) }));
    await flush();
    const response = JSON.parse(jest.mocked(platform.napplet.send).mock.calls.at(-1)![1]).reply;
    expect(response.error).toBe('insecure-origin');
  }
  expect(confirm).not.toHaveBeenCalled();
});

it.each([true, false])('settles native response-download policy before commit (allowed: %s)', async allowed => {
  confirm.mockResolvedValue(allowed ? 'allow' : false);
  receive('container', JSON.stringify({ type: 'explore.navigation', phase: 'start', document: 'provisional', origin: 'https://files.example', url: 'https://files.example/file' }));
  receive('container', JSON.stringify({ type: 'explore.browser', document: 'provisional', origin: 'https://site.example', policyDocument: 'one',
    browser: { id: 'response-download', action: 'download', url: 'https://files.example/file', filename: 'report.pdf' } }));
  await flush();
  expect(confirm).toHaveBeenCalledWith(expect.objectContaining({
    application: expect.objectContaining({ origin: 'https://site.example' }),
    browser: expect.objectContaining({ action: 'download', url: 'https://files.example/file' }),
  }), expect.any(AbortSignal));
  const response = JSON.parse(jest.mocked(platform.napplet.send).mock.calls.at(-1)![1]);
  expect(response).toMatchObject({ document: 'provisional', reply: { type: 'browser.result', id: 'response-download', result: allowed } });
  receive('container', JSON.stringify({ type: 'explore.request', document: 'provisional', origin: 'https://site.example',
    raw: JSON.stringify({ id: 'js-during-download', nonce: 'test-document', method: 'signEvent', args: [{ kind: 1, content: '', created_at: 1, tags: [] }] }) }));
  await flush();
  expect(jest.mocked(NappletNetwork).mock.results.at(-1)!.value.sign).not.toHaveBeenCalled();
});

it('rejects mismatched policy sources and non-download requests before commit', async () => {
  receive('container', JSON.stringify({ type: 'explore.navigation', phase: 'start', document: 'provisional', origin: 'https://files.example' }));
  for (const patch of [{ policyDocument: 'other' }, { origin: 'https://files.example' }, { document: 'old-navigation' }, { browser: { id: 'permission', action: 'permission', resources: ['clipboard-read'] } }]) {
    receive('container', JSON.stringify({ type: 'explore.browser', document: 'provisional', origin: 'https://site.example', policyDocument: 'one',
      browser: { id: 'download', action: 'download', url: 'https://files.example/file' }, ...patch }));
  }
  await flush();
  expect(confirm).not.toHaveBeenCalled();
  expect(platform.napplet.send).not.toHaveBeenCalled();
});

it('resumes a retained document with fresh authority without reviving its cancelled approval', async () => {
  let answer!: (value: string) => void;
  confirm.mockImplementationOnce(() => new Promise<string>(resolve => { answer = resolve; }));
  message('https://site.example', 'one');
  await flush();
  receive('container', JSON.stringify({ type: 'explore.navigation', phase: 'start', document: 'failed-navigation', origin: 'https://other.example' }));
  receive('container', JSON.stringify({ type: 'explore.navigation', phase: 'resume', previousDocument: 'one', document: 'resumed', origin: 'https://site.example', url: entry.address }));
  answer('allow');
  await flush();
  const network = jest.mocked(NappletNetwork).mock.results.at(-1)!.value;
  expect(network.sign).not.toHaveBeenCalled();
  expect(platform.napplet.send).not.toHaveBeenCalled();
  confirm.mockResolvedValue('allow');
  receive('container', JSON.stringify({ type: 'explore.request', document: 'resumed', origin: 'https://site.example',
    raw: JSON.stringify({ id: 'after-failure', nonce: 'test-document', method: 'signEvent', args: [{ kind: 1, content: 'new request', created_at: 1, tags: [] }] }) }));
  await flush();
  expect(network.sign).toHaveBeenCalledTimes(1);
  expect(JSON.parse(jest.mocked(platform.napplet.send).mock.calls.at(-1)![1]).document).toBe('resumed');
});

it('does not resume an unrelated document or replace a successful commit with a stale resume', async () => {
  receive('container', JSON.stringify({ type: 'explore.navigation', phase: 'start', document: 'pending', origin: 'https://other.example' }));
  receive('container', JSON.stringify({ type: 'explore.navigation', phase: 'resume', previousDocument: 'unknown', document: 'forged-resume', origin: 'https://site.example' }));
  receive('container', JSON.stringify({ type: 'explore.navigation', phase: 'commit', document: 'pending', origin: 'https://other.example' }));
  receive('container', JSON.stringify({ type: 'explore.navigation', phase: 'resume', previousDocument: 'one', document: 'stale-resume', origin: 'https://site.example' }));
  receive('container', JSON.stringify({ type: 'explore.request', document: 'stale-resume', origin: 'https://site.example', raw: JSON.stringify({ id: 'old', nonce: 'test-document', method: 'getPublicKey', args: [] }) }));
  await flush();
  expect(confirm).not.toHaveBeenCalled();
  expect(platform.napplet.send).not.toHaveBeenCalled();
});
