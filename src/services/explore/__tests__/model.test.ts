import { finalizeEvent, generateSecretKey } from 'nostr-tools';
import { decode, naddrEncode, neventEncode } from 'nostr-tools/nip19';
import { applicationCopyAddress, applicationShareLink, mergeApplicationEntries, websiteEntry, parseSite, sitePath, websiteAddress, signedAddress, withVisit } from '../model';
const key = generateSecretKey();
const manifest = (kind = 35130, extra: string[][] = []) => finalizeEvent({ kind, created_at: 1, content: 'A site', tags: [['d', 'demo'], ['path', '/index.html', 'a'.repeat(64)], ['path', '/app.js', 'b'.repeat(64)], ['server', 'https://media.example/'], ...extra] }, key);

it.each([15128, 15129, 35128, 35129, 35130])('shares replaceable kind %s by coordinate while retaining relay hints', kind => {
  const event = manifest(kind);
  const relays = ['wss://private.example/'];
  const entry = { kind: 'napp' as const, manifest: event, address: `nostr:${neventEncode({ id: event.id, relays, author: event.pubkey, kind })}` };
  const address = applicationCopyAddress(entry);
  expect(decode(address)).toEqual({ type: 'naddr', data: { kind, pubkey: event.pubkey, identifier: kind >= 30000 ? 'demo' : '', relays } });
  expect(applicationShareLink(entry)).toBe(`nostr:${address}`);
});

it('preserves immutable event routing hints and fills author and kind from the manifest', () => {
  const event = manifest(5129);
  const relays = ['wss://private.example/'];
  const entry = { kind: 'napplet' as const, manifest: event, address: neventEncode({ id: event.id, relays }) };
  const address = applicationCopyAddress(entry);
  expect(decode(address)).toEqual({ type: 'nevent', data: { id: event.id, author: event.pubkey, kind: 5129, relays } });
  expect(applicationShareLink(entry)).toBe(`nostr:${address}`);
});

it('retains routing hints before metadata is loaded and avoids duplicate URI prefixes', () => {
  const event = manifest();
  const relays = ['wss://private.example/'];
  const pointers = [naddrEncode({ kind: event.kind, pubkey: event.pubkey, identifier: 'demo', relays }),
    neventEncode({ id: event.id, author: event.pubkey, kind: 5129, relays })];
  for (const pointer of pointers) {
    const entry = { kind: 'napp' as const, address: `nostr:${pointer}` };
    expect(applicationCopyAddress(entry)).toBe(pointer);
    expect(applicationShareLink(entry)).toBe(`nostr:${pointer}`);
  }
});

it('omits relay hints when their location is unknown and leaves website URLs unchanged', () => {
  const entry = parseSite(manifest());
  const decoded = decode(applicationCopyAddress(entry));
  expect(decoded.type).toBe('naddr');
  expect(decoded.data).toMatchObject({ relays: [] });
  const event = manifest(5129);
  expect(decode(applicationCopyAddress({ kind: 'napplet', manifest: event, address: neventEncode({ id: event.id }) })).data)
    .toMatchObject({ relays: [] });
  const website = websiteEntry('https://example.com/path?q=1');
  expect(applicationCopyAddress(website)).toBe(website.address);
  expect(applicationShareLink(website)).toBe(website.address);
});
it('classifies by signed kind and accepts several static files', () => {
  const app = parseSite(manifest());
  expect(app.kind).toBe('napp');
  expect(app.required).toContain('network');
  expect(app.manifest!.tags).not.toContainEqual(['requires', 'network']);
  expect(app.files).toHaveLength(2);
  expect(app.files![1].mime).toBe('text/javascript');
  expect(signedAddress(app.key)?.source).toBe(app.key);
  expect(parseSite(manifest(35128, [['requires', 'identity']])).kind).toBe('nsite');
  expect(parseSite(manifest(35128, [['requires', 'identity']])).required).toEqual(['identity']);
});
it.each(['/../secret', '//other/path', '/a/./b', '/a%2fb', '/path?query', '/a\\b'])('rejects ambiguous or escaping paths %s', path => expect(() => sitePath(path)).toThrow());
it('rejects modified signatures, duplicate paths and invalid aggregates', () => {
  expect(() => parseSite({ ...manifest(), content: 'modified' })).toThrow();
  expect(() => parseSite(manifest(35130, [['path', '/index.html', 'c'.repeat(64)]]))).toThrow();
  expect(() => parseSite(manifest(35130, [['x', '0'.repeat(64), 'aggregate']]))).toThrow();
});
it('normalizes website addresses without dropping the visited path', () => {
  expect(websiteAddress('EXAMPLE.com/path?q=1')).toBe('https://example.com/path?q=1');
  expect(() => websiteAddress('file:///etc/passwd')).toThrow();
  expect(() => websiteAddress('https://user:password@example.com')).toThrow();
});

it('keeps old shortcuts when the recent-address window fills',()=>{
  const site=parseSite(manifest());
  const shortcut={...site,key:'shortcut',desktopPosition:0,lastUsedAt:1};
  const entries=[shortcut,...Array.from({length:512},(_,index)=>({...site,key:`site-${index}`,lastUsedAt:index+2}))];
  const next=withVisit(entries,{...site,key:'new'},10000);
  expect(next.find(entry=>entry.key==='shortcut')?.desktopPosition).toBe(0);
  expect(next.find(entry=>entry.key==='shortcut')?.lastUsedAt).toBe(null);
  expect(next.filter(entry=>entry.lastUsedAt!==null)).toHaveLength(512);
  expect(next.some(entry=>entry.key==='new')).toBe(true);
});


it('preserves list and row identities for timestamp-only refreshes', () => {
  const first = websiteEntry('https://one.example/'), second = websiteEntry('https://two.example/');
  const previous = [first, second];
  expect(mergeApplicationEntries(previous, [{ ...first }, { ...second }])).toBe(previous);
  const updated = mergeApplicationEntries(previous, [{ ...first }, { ...second, title: 'Updated' }]);
  expect(updated[0]).toBe(first);
  expect(updated[1]).toMatchObject({ title: 'Updated' });
});
