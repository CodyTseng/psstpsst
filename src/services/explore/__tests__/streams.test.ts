import { ExploreStreams } from '../streams';
import { localRelay } from '@/services/local-relay';
import type { NappletNetwork } from '@/services/napplet/network';

jest.mock('@/services/local-relay',()=>({localRelay:{subscribe:jest.fn(),add:jest.fn()}}));
jest.mock('@/services/napplet/network',()=>({relayUrls:(urls:string[])=>urls}));
const filters={kinds:[1]};
const flush=()=>new Promise<void>(resolve=>setTimeout(resolve,10));

beforeEach(()=>jest.clearAllMocks());
it('ends local subscription listeners with their document without touching shared data',()=>{
 const network={} as NappletNetwork,streams=new ExploreStreams(network),signal=new AbortController(),send=jest.fn(async()=>{}),cleanup=jest.fn();
 let deliver!:(event:any)=>void;
 jest.mocked(localRelay.subscribe).mockImplementation((_filters,listener)=>{deliver=listener;return cleanup;});
 streams.open('storeSubscribe',['local',filters],signal.signal,send,jest.fn());
 deliver({id:'stored'});expect(send).toHaveBeenCalledWith({type:'stream',streamId:'local',phase:'event',event:{id:'stored'}});
 signal.abort();expect(cleanup).toHaveBeenCalledTimes(1);
 deliver({id:'late'});expect(send).toHaveBeenCalledTimes(1);expect(localRelay.add).not.toHaveBeenCalled();
});
it('delivers remote events and EOSE without automatically inserting them locally',async()=>{
 let options:any;
 const cleanup=jest.fn(),subscribe=jest.fn(input=>{options=input;return cleanup;});
 const streams=new ExploreStreams({subscribe} as unknown as NappletNetwork),signal=new AbortController(),send=jest.fn(async()=>{});
 streams.open('relaySubscribe',['remote',['wss://relay.example/'],filters,{}],signal.signal,send,jest.fn());
 options.onEvent({id:'initial',content:'note',tags:[]});options.onEose();
 await flush();
 expect(send.mock.calls.map(([message]:any[])=>message.phase)).toEqual(['initial','eose']);
 options.onEvent({id:'live',content:'note',tags:[]});await flush();
 expect(send).toHaveBeenLastCalledWith(expect.objectContaining({phase:'event',event:expect.objectContaining({id:'live'})}));
 expect(localRelay.add).not.toHaveBeenCalled();
 streams.clear();expect(cleanup).toHaveBeenCalledTimes(1);
});
