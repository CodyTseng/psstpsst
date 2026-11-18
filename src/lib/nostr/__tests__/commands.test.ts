import chirliFixture from './fixtures/chirli-command.json';
import { finalizeEvent, generateSecretKey, verifyEvent, type Event } from 'nostr-tools';
import { availableCommands, commandInScope, commandQuery, mergeCommandEvents, parseCommand } from '../commands';

const secret = generateSecretKey();
const author = finalizeEvent({kind: 1, content: '', created_at: 1, tags: []}, secret).pubkey;
const context = { kind: 14, pubkey: 'b'.repeat(64), tags: [['p', author], ['e', 'reply']], relays: ['wss://relay.example/'] };
function event(created_at = 1, tags: string[][] = []): Event {
  return finalizeEvent({kind: 31992, content: '', created_at, tags: [
    ['d', 'stable:echo'], ['command', 'echo'], ['title', 'Echo'], ['description', 'Echo text'],
    ['arg', 'text', 'text', 'optional', 'Text'], ...tags,
  ]}, secret);
}
function deletion(tags: string[][], created_at = 2, key = secret) { return finalizeEvent({kind: 5, content: '', tags, created_at}, key); }

test('accepts Chirli-shaped declarations and restricts the slash to the start of the entire draft', () => {
  expect(parseCommand(event())?.command).toBe('echo');
  expect(['/','/e','/echo'].map(commandQuery)).toEqual(['','e','echo']);
  expect(['//','hi /echo',' /echo','/echo arg','/echo\n','/echo@nostr:npub'].map(commandQuery)).toEqual(Array(6).fill(null));
});

test('matches scope alternatives within each type and intersects different types and tag names', () => {
  const command = parseCommand(event(1, [['s','kind:4'],['s','kind:14'],['s',`author:${context.pubkey}`],['s',`tag:p:${author}`],['s','tag:e'],['s','relay:wss://relay.example']]))!;
  expect(commandInScope(command, context)).toBe(true);
  expect(commandInScope(command, {...context, kind: 1059})).toBe(false);
  expect(commandInScope(command, {...context, tags: [['p', author]]})).toBe(false);
  expect(commandInScope(command, {...context, relays: []})).toBe(false);
  expect(parseCommand(event(1, [['s','unknown:constraint']]))).toBeNull();
});

test('newest malformed declarations retire earlier commands; equal timestamp uses lowest ID', () => {
  const old = event(), invalid = event(2, [['command','duplicate']]);
  expect(availableCommands([old, invalid, old], context)).toEqual([]);
  const a = event(3), b = event(3, [['s','kind:14']]);
  expect(mergeCommandEvents([a,b])[0].id).toBe([a.id,b.id].sort()[0]);
});

test('persists deletion evidence, rejects other authors, and allows newer republication', () => {
  const old = event(), address = `31992:${author}:stable:echo`;
  const revoke = deletion([['a', address]]);
  expect(availableCommands(mergeCommandEvents([old,revoke,old]), context)).toEqual([]);
  expect(availableCommands([old,deletion([['a',address]],2,generateSecretKey())],context)).toHaveLength(1);
  expect(availableCommands([old,revoke,event(3)],context)).toHaveLength(1);
  expect(availableCommands([old,deletion([['e',old.id]])],context)).toEqual([]);
});

test('rejects malformed argument definitions and singleton fields', () => {
  expect(parseCommand(event(1,[['s','kind:99999']]))).toBeNull();
  expect(parseCommand(event(1,[['arg','after','word','required','After']]))).toBeNull();
  expect(parseCommand(event(1,[['title','duplicate']]))).toBeNull();
});

test('decodes an event encoded by the local Chirli SDK without client-specific fields', () => {
  // Generated with chirli/dist/nipcd.js encodeCommandDefinition and a test-only key.
  const event = chirliFixture as Event;
  expect(verifyEvent(event)).toBe(true);
  expect(availableCommands([event], context).map(command => command.command)).toEqual(['echo']);
});

test('addressable declarations without a d tag use the NIP-01 empty identifier', () => {
  const declaration = event();
  declaration.tags = declaration.tags.filter(tag => tag[0] !== 'd');
  expect(parseCommand(declaration)?.command).toBe('echo');
});
