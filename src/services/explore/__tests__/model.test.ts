import { finalizeEvent, generateSecretKey } from 'nostr-tools';
import { parseSite, sitePath, websiteAddress, signedAddress, withVisit } from '../model';
const key = generateSecretKey();
const manifest = (kind = 35130, extra: string[][] = []) => finalizeEvent({ kind, created_at: 1, content: 'A site', tags: [['d', 'demo'], ['path', '/index.html', 'a'.repeat(64)], ['path', '/app.js', 'b'.repeat(64)], ['server', 'https://media.example/'], ...extra] }, key);
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
