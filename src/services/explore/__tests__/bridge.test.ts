import { exploreBridge } from '@/lib/napp/bridge';

// Protocol tests use an idle document; browser behavior is covered by browser tests.
const documentBeforeReady = { readyState: 'loading', execCommand: () => false, addEventListener: () => {} };

it.each([true, false])('injects NIP-07 before page scripts (napp: %s)', async (napp) => {
  const post = jest.fn();
  const page: any = { __exploreDocumentToken: 'document', __psstExplore: { post } };
  page.top = page;
  new Function('window', 'addEventListener', 'requestAnimationFrame', 'document', exploreBridge(napp))(
    page, jest.fn(), jest.fn(), documentBeforeReady,
  );
  expect(typeof page.nostr.signEvent).toBe('function');
  const result = page.nostr.getPublicKey();
  const request = JSON.parse(post.mock.calls[0][0]);
  expect(request.method).toBe('getPublicKey');
  page.__exploreReceive({ id: request.id, nonce: request.nonce, result: 'account' });
  await expect(result).resolves.toBe('account');
});

it('forwards uncaught napp errors and promise rejections to host diagnostics', () => {
  const post = jest.fn();
  const page: any = { __exploreDocumentToken: 'document', __psstExplore: { post } };
  page.top = page;
  const listeners = new Map<string, Function>();
  const listen = (name: string, handler: Function) => listeners.set(name, handler);
  new Function('window', 'addEventListener', 'requestAnimationFrame', 'document', exploreBridge(true))(
    page, listen, jest.fn(), documentBeforeReady,
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
  const page: any = { __exploreDocumentToken: 'document', __psstExplore: { post: (raw: string) => {
    const request=JSON.parse(raw);requests.push(request);
    queueMicrotask(()=>page.__exploreReceive({id:request.id,nonce:request.nonce,result:true}));
  } } };
  page.top=page;
  new Function('window','addEventListener','requestAnimationFrame','document',exploreBridge(true))(page,jest.fn(),jest.fn(),documentBeforeReady);
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

it('groups initial remote events until EOSE and forwards later events separately', async () => {
  const requests: any[]=[];
  const page: any={__exploreDocumentToken:'document',__psstExplore:{post:(raw:string)=>{
    const request=JSON.parse(raw);requests.push(request);
    queueMicrotask(()=>page.__exploreReceive({id:request.id,nonce:request.nonce,result:true}));
  }}};
  page.top=page;
  new Function('window','addEventListener','requestAnimationFrame','document',exploreBridge(true))(page,jest.fn(),jest.fn(),documentBeforeReady);
  const initial=jest.fn(),live=jest.fn();
  const close=page.napp.utils.subscribe(['wss://relay.example/'],{kinds:[1]}, {eoseEventsCallback:initial,liveEventCallback:live});
  const streamId=requests[0].args[0];
  const emit=(phase:string,event?:unknown)=>page.__exploreReceive({type:'stream',streamId,nonce:'document',phase,event});
  emit('initial',{id:'old'});expect(initial).not.toHaveBeenCalled();emit('eose');emit('event',{id:'new'});
  expect(initial).toHaveBeenCalledWith([{id:'old'}]);expect(live).toHaveBeenCalledWith({id:'new'});
  close();await Promise.resolve();
});
