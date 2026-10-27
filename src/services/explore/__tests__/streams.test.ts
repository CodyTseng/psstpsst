import { ExploreStreams } from '../streams';
import { localRelay } from '@/services/local-relay';
import type { NappletNetwork } from '@/services/napplet/network';

jest.mock('@/services/local-relay',()=>({localRelay:{subscribe:jest.fn(),add:jest.fn()}}));
jest.mock('@/services/napplet/network',()=>({relayUrls:(urls:string[])=>urls}));
const filters={kinds:[1]};
const flush=()=>new Promise<void>(resolve=>setTimeout(resolve,10));

beforeEach(()=>jest.clearAllMocks());
it('does not close a subscription when a historical burst exceeds 128 events',async()=>{
 jest.useFakeTimers();
 let options:any;
 const streams=new ExploreStreams({subscribe:jest.fn(input=>{options=input;return()=>{};})} as unknown as NappletNetwork);
 const send=jest.fn(async(_message:any)=>{});
 try {
  await streams.open('relaySubscribe',['burst',['wss://relay.example/'],filters,{}],new AbortController().signal,send,jest.fn());
  for(let i=0;i<150;i++)options.onEvent({id:String(i),kind:1,content:'note',tags:[]});
  await jest.runAllTimersAsync();
  expect(send).toHaveBeenCalledTimes(150);
  expect(send.mock.calls.every(([message])=>message.phase==='event')).toBe(true);
 } finally { streams.clear();jest.useRealTimers(); }
});
it('forwards remote filter extensions and limits unchanged',async()=>{
 const subscribe=jest.fn((_options:any)=>()=>{}),streams=new ExploreStreams({subscribe} as unknown as NappletNetwork);
 const filter={search:'x'.repeat(5000),'#client':['custom'],limit:100000,extension:true};
 await streams.open('relaySubscribe',['remote',['wss://relay.example/'],filter,{}],new AbortController().signal,jest.fn(async()=>{}),jest.fn());
 expect(subscribe.mock.calls[0][0].filters).toEqual([filter]);
 streams.clear();
});
it('loads all author routes before opening outbox subscriptions and preserves each filter scope',async()=>{
 const authors=Array.from({length:101},(_,i)=>i.toString(16).padStart(64,'0'));
 let resolve!:(routes:Map<string,string[]>)=>void;
 const outboxRoutes=jest.fn(()=>new Promise<Map<string,string[]>>(done=>{resolve=done;}));
 const subscribe=jest.fn((_options:any,_auth:any)=>()=>{});
 const streams=new ExploreStreams({outboxRoutes,subscribe} as unknown as NappletNetwork),signal=new AbortController();
 const first={authors,kinds:[1],limit:100000},second={authors:[authors[0]],kinds:[30023],'#d':['x'.repeat(5000)]};
 const pending=streams.open('outboxSubscribe',['outbox',[],[first,second],{}],signal.signal,jest.fn(async()=>{}),jest.fn());
 expect(outboxRoutes).toHaveBeenCalledWith(authors,signal.signal);expect(subscribe).not.toHaveBeenCalled();
 resolve(new Map([['wss://shared.example/',authors],['wss://other.example/',[authors[0]]]]));await pending;
 expect(subscribe.mock.calls[0][0].filters).toEqual([first,second]);
 expect(subscribe.mock.calls[1][0].filters).toEqual([{...first,authors:[authors[0]]},second]);
 streams.clear();
});
it('ends local subscription listeners with their document without touching shared data',async()=>{
 const network={} as NappletNetwork,streams=new ExploreStreams(network),signal=new AbortController(),send=jest.fn(async()=>{}),cleanup=jest.fn();
 let deliver!:(event:any)=>void;
 jest.mocked(localRelay.subscribe).mockImplementation((_filters,listener)=>{deliver=listener;return cleanup;});
 await streams.open('storeSubscribe',['local',filters],signal.signal,send,jest.fn());
 deliver({id:'stored'});expect(send).toHaveBeenCalledWith({type:'stream',streamId:'local',phase:'event',event:{id:'stored'}});
 signal.abort();expect(cleanup).toHaveBeenCalledTimes(1);
 deliver({id:'late'});expect(send).toHaveBeenCalledTimes(1);expect(localRelay.add).not.toHaveBeenCalled();
});
it('stores public remote events before delivering them and EOSE',async()=>{
 let options:any;
 const cleanup=jest.fn(),subscribe=jest.fn(input=>{options=input;return cleanup;});
 const streams=new ExploreStreams({subscribe} as unknown as NappletNetwork),signal=new AbortController(),send=jest.fn(async(_message:any)=>{});
 await streams.open('relaySubscribe',['remote',['wss://relay.example/'],filters,{}],signal.signal,send,jest.fn());
 options.onEvent({id:'initial',content:'note',tags:[]});options.onEnd([{url:'wss://relay.example/',status:'eose',received:1}]);
 await flush();
 expect(send.mock.calls.map(([message]:any[])=>message.phase)).toEqual(['event','eose']);
 expect(send.mock.calls[1][0]).toEqual({type:'stream',streamId:'remote',phase:'eose',url:'wss://relay.example/'});
 options.onEvent({id:'live',content:'note',tags:[]});await flush();
 expect(send).toHaveBeenLastCalledWith(expect.objectContaining({phase:'event',event:expect.objectContaining({id:'live'})}));
 expect(localRelay.add).toHaveBeenCalledTimes(2);
 streams.clear();expect(cleanup).toHaveBeenCalledTimes(1);
});
it('delivers events and EOSE from a fast relay without waiting for another relay',async()=>{
 const subscriptions=new Map<string,any>(),subscribe=jest.fn(options=>{subscriptions.set(options.relays[0],options);return()=>{};});
 const streams=new ExploreStreams({subscribe} as unknown as NappletNetwork),send=jest.fn(async(_message:any)=>{});
 await streams.open('relaySubscribe',['remote',['wss://fast.example/','wss://slow.example/'],filters,{}],new AbortController().signal,send,jest.fn());
 subscriptions.get('wss://fast.example/').onEvent({id:'first',content:'note',tags:[]});
 await flush();expect(send).toHaveBeenCalledWith(expect.objectContaining({phase:'event',event:expect.objectContaining({id:'first'})}));
 subscriptions.get('wss://fast.example/').onEnd([{url:'wss://fast.example/',status:'eose',received:1}]);await flush();
 expect(send).toHaveBeenLastCalledWith({type:'stream',streamId:'remote',phase:'eose',url:'wss://fast.example/'});
 subscriptions.get('wss://slow.example/').onEvent({id:'second',content:'note',tags:[]});
 subscriptions.get('wss://slow.example/').onEnd([{url:'wss://slow.example/',status:'eose',received:1}]);await flush();
 expect(send.mock.calls.map(([message])=>message.phase)).toEqual(['event','eose','event','eose']);
 streams.clear();
});
it('does not turn relay failures or timeouts into EOSE notifications',async()=>{
 let options:any;
 const subscribe=jest.fn(input=>{options=input;return()=>{};});
 const streams=new ExploreStreams({subscribe} as unknown as NappletNetwork),send=jest.fn(async()=>{});
 await streams.open('relaySubscribe',['remote',['wss://relay.example/'],filters,{}],new AbortController().signal,send,jest.fn());
 options.onEnd([{url:'wss://relay.example/',status:'eose',received:0,reason:'query timed out'}]);
 await flush();expect(send).not.toHaveBeenCalled();streams.clear();
});
