import { exploreBridge } from '@/lib/napp/bridge';

// Protocol tests use an idle document; browser behavior is covered by browser tests.
const documentBeforeReady = { readyState: 'loading', execCommand: () => false, addEventListener: () => {} };

it.each([true, false])('injects NIP-07 before page scripts (napp: %s)', async (napp) => {
  const post = jest.fn();
  const page: any = { __exploreDocumentCommitted: true, __exploreNativeDocumentToken: 'native-document', __exploreDocumentToken: 'document', __psstExplore: { post } };
  page.top = page;
  new Function('window', 'addEventListener', 'requestAnimationFrame', 'document', 'navigator', exploreBridge(napp))(
    page, jest.fn(), jest.fn(), documentBeforeReady, {},
  );
  expect(typeof page.nostr.signEvent).toBe('function');
  const result = page.nostr.getPublicKey();
  const request = JSON.parse(post.mock.calls[0][0]);
  expect(request.method).toBe('getPublicKey');
  page.__exploreReceive({ id: request.id, nonce: request.nonce, result: 'account' });
  await expect(result).resolves.toBe('account');
});

it.each([true, false])('exposes the complete local database API and preserves add results (napp: %s)', async napp => {
  const post = jest.fn();
  const page: any = { __exploreDocumentCommitted: true, __exploreDocumentToken: 'document', __psstExplore: { post } };page.top = page;
  new Function('window','addEventListener','requestAnimationFrame','document','navigator',exploreBridge(napp))(page,jest.fn(),jest.fn(),documentBeforeReady,{});
  expect(Object.keys(page.nostrdb).sort()).toEqual(['add','count','event','query','remove','replaceable','subscribe','supports']);
  for (const result of [true, false]) {
    const added = page.nostrdb.add({id:'event'}), request = JSON.parse(post.mock.calls.at(-1)![0]);
    page.__exploreReceive({id:request.id,nonce:request.nonce,result});
    await expect(added).resolves.toBe(result);
  }
  await expect(page.nostrdb.supports()).resolves.toEqual([]);
});

it('forwards uncaught napp errors and promise rejections to host diagnostics', () => {
  const post = jest.fn();
  const page: any = { __exploreDocumentCommitted: true, __exploreNativeDocumentToken: 'native-document', __exploreDocumentToken: 'document', __psstExplore: { post } };
  page.top = page;
  const listeners = new Map<string, Function>();
  const listen = (name: string, handler: Function) => listeners.set(name, handler);
  new Function('window', 'addEventListener', 'requestAnimationFrame', 'document', 'navigator', exploreBridge(true))(
    page, listen, jest.fn(), documentBeforeReady, {},
  );
  listeners.get('error')!({ error: new TypeError('missing API') });
  listeners.get('unhandledrejection')!({ reason: new Error('request failed') });
  expect(post.mock.calls.map(([raw]) => JSON.parse(raw).args[0])).toEqual([
    'TypeError: missing API', 'Error: request failed',
  ]);
  for (const [raw] of post.mock.calls) {
    const request = JSON.parse(raw);
    page.__exploreReceive({ id: request.id, nonce: request.nonce, result: true });
  }
});

it('delivers local subscriptions as async iterators and closes the host stream on return', async () => {
  const requests: any[] = [];
  const page: any = { __exploreDocumentCommitted: true, __exploreNativeDocumentToken: 'native-document', __exploreDocumentToken: 'document', __psstExplore: { post: (raw: string) => {
    const request=JSON.parse(raw);requests.push(request);
    queueMicrotask(()=>page.__exploreReceive({id:request.id,nonce:request.nonce,result:true}));
  } } };
  page.top=page;
  new Function('window','addEventListener','requestAnimationFrame','document','navigator',exploreBridge(true))(page,jest.fn(),jest.fn(),documentBeforeReady, {});
  const iterator=page.nostrdb.subscribe({kinds:[1],limit:0});
  const streamId=requests[0].args[0];
  const next=iterator.next();
  page.__exploreReceive({type:'stream',streamId,nonce:'other-document',phase:'event',event:{id:'spoof'}});
  page.__exploreReceive({type:'stream',streamId,nonce:'document',phase:'event',event:{id:'event'}});
  await expect(next).resolves.toEqual({done:false,value:{id:'event'}});
  await iterator.return();
  await expect(iterator.next()).resolves.toEqual({done:true,value:undefined});
  expect(requests.at(-1).method).toBe('streamClose');
  await Promise.resolve();
});

it('forwards every remote event immediately and reports each relay EOSE separately', async () => {
  const requests: any[]=[];
  const page: any={__exploreDocumentCommitted:true,__exploreNativeDocumentToken:'native-document',__exploreDocumentToken:'document',__psstExplore:{post:(raw:string)=>{
    const request=JSON.parse(raw);requests.push(request);
    queueMicrotask(()=>page.__exploreReceive({id:request.id,nonce:request.nonce,result:true}));
  }}};
  page.top=page;
  new Function('window','addEventListener','requestAnimationFrame','document','navigator',exploreBridge(true))(page,jest.fn(),jest.fn(),documentBeforeReady, {});
  const eose=jest.fn(),live=jest.fn();
  const close=page.napp.utils.subscribe(['wss://relay.example/'],{kinds:[1]}, {eoseCallback:eose,liveEventCallback:live});
  const streamId=requests[0].args[0];
  const emit=(phase:string,event?:unknown,url?:string)=>page.__exploreReceive({type:'stream',streamId,nonce:'document',phase,event,url});
  emit('event',{id:'old'});expect(live).toHaveBeenCalledWith({id:'old'});expect(eose).not.toHaveBeenCalled();
  emit('eose',undefined,'wss://relay.example/');emit('event',{id:'new'});
  expect(eose).toHaveBeenCalledWith('wss://relay.example/');expect(live).toHaveBeenCalledWith({id:'new'});
  close();await Promise.resolve();
});

it.each([true, false])('exposes WebLN with document-correlated replies (napp: %s)', async napp => {
  const post = jest.fn();
  const page: any = { __exploreDocumentCommitted: true, __exploreNativeDocumentToken: 'native-document', __exploreDocumentToken: 'document', __psstExplore: { post } }; page.top = page;
  new Function('window', 'addEventListener', 'requestAnimationFrame', 'document', 'navigator', exploreBridge(napp))(
    page, jest.fn(), jest.fn(), documentBeforeReady, {});
  const payment = page.webln.sendPayment('invoice');
  const request = JSON.parse(post.mock.calls[0][0]);
  expect(request).toMatchObject({ method: 'webln.sendPayment', args: ['invoice'] });
  page.__exploreReceive({ id: request.id, nonce: 'old-document', result: { preimage: 'wrong' } });
  page.__exploreReceive({ id: request.id, nonce: request.nonce, result: { preimage: 'proof' } });
  await expect(payment).resolves.toEqual({ preimage: 'proof' });
});
it('never installs wallet authority in a subframe', () => {
  const page: any = { top: {} };
  new Function('window', exploreBridge(false))(page);
  expect(page.webln).toBeUndefined();
});

it('holds document-start calls until native commit and attaches the native document token', async () => {
  const post = jest.fn();
  const page: any = { __exploreDocumentToken: 'nonce', __psstExplore: { post } };
  page.top = page;
  new Function('window', 'addEventListener', 'requestAnimationFrame', 'document', 'navigator', exploreBridge(false))(
    page, jest.fn(), jest.fn(), documentBeforeReady, {},
  );
  const pending = page.nostr.getPublicKey();
  expect(post).not.toHaveBeenCalled();
  page.__exploreCommit();
  expect(post).not.toHaveBeenCalled();
  page.__exploreNativeDocumentToken = 'native-committed-document';
  page.__exploreDocumentCommitted = true;
  page.__exploreCommit();
  const request = JSON.parse(post.mock.calls[0][0]);
  expect(request.documentToken).toBe('native-committed-document');
  page.__exploreReceive({ id: request.id, nonce: request.nonce, result: 'account' });
  await expect(pending).resolves.toBe('account');
});
