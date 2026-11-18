import { useLayoutEffect } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { useCommands } from '../use-commands';
import { useProfile, useProfilesMap } from '../use-profile';
import { fetchCommandDeclarations } from '@/services/profile/command-discovery.service';
import { fetchProfile } from '@/services/profile/profile.service';
import fixture from '@/lib/nostr/__tests__/fixtures/chirli-command.json';
import type { Command } from '@/lib/nostr/commands';

let mockProfiles: unknown[] = [];
let mockCommands: unknown[] = [];
let mockInbox: unknown[] = [];
jest.mock('@/db/client', () => ({ db: jest.requireActual('drizzle-orm/sqlite-proxy').drizzle(async () => ({rows:[]})) }));
jest.mock('@/db/use-live-query', () => ({ useLiveQuery: (query: {toSQL:()=>{sql:string;params:unknown[]}}) => {
  const {sql,params} = query.toSQL();
  return {data: !sql.includes('replaceable_events') ? mockProfiles : params.includes(10050) ? mockInbox : mockCommands};
} }));
jest.mock('@/services/relay/relay-router', () => ({ capDeliveryRelays: (relays:string[]) => relays.slice(0,4) }));
jest.mock('@/services/profile/command-discovery.service', () => ({ fetchCommandDeclarations: jest.fn(async()=>{}) }));
jest.mock('@/services/profile/profile.service', () => ({ PROFILE_TTL_SECONDS:86400,fetchProfile:jest.fn(async()=>{}),fetchProfiles:jest.fn(async()=>{}) }));
const author = fixture.pubkey;
const context = {pubkey:'b'.repeat(64),kind:14,tags:[['p',author]]};
let commands: Command[];
let renderer: ReactTestRenderer | undefined;
function Commands({peer=author,enabled=true}:{peer?:string;enabled?:boolean}) {
  const result = useCommands(peer,context,enabled);
  useLayoutEffect(()=>{commands=result;}); return null;
}
function Profile({enabled=true}:{enabled?:boolean}) { useProfile(author,enabled); return null; }
function Profiles() { useProfilesMap([author,author]); return null; }
beforeEach(()=> { jest.clearAllMocks(); mockProfiles=[];mockCommands=[];mockInbox=[]; });
afterEach(()=>act(()=>renderer?.unmount()));

test('cached warm profiles proactively check commands on profile mount and bulk lifecycle',()=>{
  mockProfiles=[{pubkey:author,fetchedAt:Math.floor(Date.now()/1000),rawEvent:null}];
  act(()=>{renderer=create(<Profile/>);});
  expect(fetchCommandDeclarations).toHaveBeenCalledWith([author]);
  expect(fetchProfile).not.toHaveBeenCalled();
  act(()=>renderer?.unmount());
  act(()=>{renderer=create(<Profiles/>);});
  expect(fetchCommandDeclarations).toHaveBeenLastCalledWith([author]);
});

test('disabled profile lifecycle does not query commands',()=>{
  act(()=>{renderer=create(<Profile enabled={false}/>);});
  expect(fetchCommandDeclarations).not.toHaveBeenCalled();
});

test('old live rows never leak across conversations or when the route is inactive',()=>{
  mockCommands=[{pubkey:author,kind:31992,dTag:fixture.tags[0][1],event:fixture}];
  act(()=>{renderer=create(<Commands/>);}); expect(commands).toHaveLength(1);
  act(()=>renderer!.update(<Commands peer={'c'.repeat(64)}/>)); expect(commands).toEqual([]);
  act(()=>renderer!.update(<Commands enabled={false}/>)); expect(commands).toEqual([]);
});

test('relay-scoped commands require current-peer cached delivery relays',()=>{
  mockCommands=[{pubkey:author,kind:31992,dTag:fixture.tags[0][1],event:{...fixture,tags:[...fixture.tags,['s','relay:wss://relay.example']]}}];
  mockInbox=[{pubkey:'c'.repeat(64),event:{tags:[['relay','wss://relay.example']]}}];
  act(()=>{renderer=create(<Commands/>);});expect(commands).toEqual([]);
  mockInbox=[{pubkey:author,event:{tags:[['relay','wss://relay.example']]}}];
  act(()=>renderer!.update(<Commands/>));expect(commands).toHaveLength(1);
});


test('all current-peer declarations are available without a command list',()=>{
  const second={...fixture,id:'second',tags:fixture.tags.map(tag=>tag[0]==='command'?['command','ping']:tag[0]==='d'?['d','ping']:tag)};
  mockCommands=[{pubkey:author,kind:31992,dTag:fixture.tags[0][1],event:fixture},{pubkey:author,kind:31992,dTag:'ping',event:second}];
  act(()=>{renderer=create(<Commands/>);});expect(commands.map(command=>command.command)).toEqual(['echo','ping']);
});

test('foreign-author cached declarations never leak into peer suggestions',()=>{
  const foreign='c'.repeat(64);
  mockCommands=[{pubkey:foreign,kind:31992,dTag:fixture.tags[0][1],event:{...fixture,pubkey:foreign}}];
  act(()=>{renderer=create(<Commands/>);});expect(commands).toEqual([]);
});
