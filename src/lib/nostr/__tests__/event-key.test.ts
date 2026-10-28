import { naddrEncode, neventEncode } from 'nostr-tools/nip19';
import { eventKey, eventKeyAddress, normalizeEventKey } from '../event-key';

const pubkey = 'a'.repeat(64), id = 'b'.repeat(64);
it.each([0, 3, 10000, 15129, 19999])('uses the coordinate for replaceable kind %s', kind => {
  expect(eventKey({ id, pubkey, kind, tags: [['d', 'ignored']] })).toBe(`${kind}:${pubkey}:`);
});
it('keeps addressable identity stable across versions and preserves the complete identifier', () => {
  const event = { id, pubkey, kind: 35130, tags: [['d', '../Demo:中文']] };
  const key = `35130:${pubkey}:../Demo:中文`;
  expect(eventKey(event)).toBe(key);
  expect(eventKey({ ...event, id: 'c'.repeat(64) })).toBe(key);
  expect(normalizeEventKey(naddrEncode({ kind: event.kind, pubkey, identifier: '../Demo:中文', relays: ['wss://hint.example'] }))).toBe(key);
  expect(normalizeEventKey(eventKeyAddress(key))).toBe(key);
});
it.each([1, 5129, 9999, 20000, 29999, 40000])('uses only the event ID for immutable kind %s', kind => {
  expect(eventKey({ id, pubkey, kind, tags: [] })).toBe(id);
});
it('treats event references as IDs until the verified event supplies its coordinate', () => {
  expect(normalizeEventKey(neventEncode({ id, author: pubkey, kind: 35130, relays: ['wss://hint.example'] }))).toBe(id);
  expect(normalizeEventKey(`5129:${id}`)).toBe(id);
});
it.each([`1:${pubkey}:`, `15129:${pubkey}:unexpected`, `35130:invalid:app`, `035130:${pubkey}:app`])('rejects invalid event identities: %s', value => {
  expect(() => normalizeEventKey(value)).toThrow();
});
