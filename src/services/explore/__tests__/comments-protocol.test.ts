import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools';
import type { ExploreEntry } from '../model';
import { applicationCommentTarget, commentFilter, commentTemplate, parseApplicationComment } from '../comments-protocol';

const publisher = generateSecretKey(), commenter = generateSecretKey();
const manifest = (kind = 35130, created_at = 1) => finalizeEvent({ kind, created_at, content: '', tags: [['d', 'demo']] }, publisher);
const entry = (kind = 35130, created_at = 1) => ({ kind: 'napp', manifest: manifest(kind, created_at) }) as ExploreEntry;
const target = applicationCommentTarget(entry())!;

it('retains a stable address scope across application versions and filters only NIP-22 comments', () => {
  const newer = applicationCommentTarget(entry(35130, 2))!;
  expect(newer.key).toBe(target.key);
  expect(newer.eventId).not.toBe(target.eventId);
  expect(commentFilter(target, 100, 123)).toEqual({ kinds: [1111], '#A': [target.value], limit: 100, until: 123 });
});

it('creates an addressable top-level review with root and parent kinds, authors and the exact reviewed version', () => {
  const template = commentTemplate(target, '  Useful app  ');
  expect(template.content).toBe('Useful app');
  expect(template.tags).toEqual(expect.arrayContaining([
    ['A', target.value], ['K', '35130'], ['P', getPublicKey(publisher)],
    ['a', target.value], ['k', '35130'], ['p', getPublicKey(publisher)], ['e', target.eventId, '', getPublicKey(publisher)],
  ]));
  const event = finalizeEvent(template, commenter);
  expect(parseApplicationComment(event, target)?.parentId).toBeUndefined();
  expect(parseApplicationComment(event, target)?.event.id).toBe(event.id);
});

it('keeps the application root while pointing a reply at its actual parent comment', () => {
  const parent = parseApplicationComment(finalizeEvent(commentTemplate(target, 'Review'), commenter), target)!;
  const response = finalizeEvent(commentTemplate(target, 'Reply', parent), publisher);
  expect(response.tags).toEqual(expect.arrayContaining([
    ['A', target.value], ['K', target.kind], ['P', target.author],
    ['e', parent.event.id, '', parent.event.pubkey], ['k', '1111'], ['p', parent.event.pubkey],
  ]));
  expect(parseApplicationComment(response, target)?.parentId).toBe(parent.event.id);
});

it.each([15128, 35128, 15129, 35129])('supports replaceable application kind %s', kind => {
  const root = applicationCommentTarget(entry(kind))!;
  const event = finalizeEvent(commentTemplate(root, 'Review'), commenter);
  expect(root.tag).toBe('A');
  expect(parseApplicationComment(event, root)?.event.id).toBe(event.id);
});

it('uses an event scope for immutable legacy applications', () => {
  const root = applicationCommentTarget(entry(5129))!;
  const event = finalizeEvent(commentTemplate(root, 'Review'), commenter);
  expect(root.tag).toBe('E');
  expect(event.tags).toContainEqual(['E', root.value, '', root.author]);
  expect(event.tags).toContainEqual(['e', root.value, '', root.author]);
  expect(parseApplicationComment(event, root)?.event.id).toBe(event.id);
});

it('uses NIP-73 URL scopes for website reviews without inventing an author', () => {
  const root = applicationCommentTarget({ kind: 'website', address: 'https://EXAMPLE.com/app?q=1' } as ExploreEntry)!;
  const event = finalizeEvent(commentTemplate(root, 'Review'), commenter);
  expect(event.tags).toEqual([['I', 'https://example.com/app?q=1'], ['K', 'web'], ['i', 'https://example.com/app?q=1'], ['k', 'web']]);
  expect(parseApplicationComment(event, root)?.event.id).toBe(event.id);
});

it('rejects forged cached verification results and comments from another root', () => {
  const valid = finalizeEvent(commentTemplate(target, 'Review'), commenter);
  expect(parseApplicationComment(valid, target)).toBeDefined();
  expect(parseApplicationComment({ ...valid, content: 'forged' }, target)).toBeUndefined();
  const other = applicationCommentTarget({ kind: 'website', address: 'https://other.example/' } as ExploreEntry)!;
  expect(parseApplicationComment(finalizeEvent(commentTemplate(other, 'Other app'), commenter), target)).toBeUndefined();
});

it('rejects signed replies with missing root/parent metadata or an unrelated root author', () => {
  const template = commentTemplate(target, 'Review');
  for (const omitted of ['K', 'P', 'k', 'p']) {
    expect(parseApplicationComment(finalizeEvent({ ...template, tags: template.tags.filter(tag => tag[0] !== omitted) }, commenter), target)).toBeUndefined();
  }
  const forgedAuthor = { ...template, tags: template.tags.map(tag => tag[0] === 'P' ? ['P', getPublicKey(commenter)] : tag) };
  expect(parseApplicationComment(finalizeEvent(forgedAuthor, commenter), target)).toBeUndefined();
  expect(() => commentTemplate(target, '  ')).toThrow('invalid-comment');
});

it('rejects oversized metadata before retaining a comment in the live queue', () => {
  const template = commentTemplate(target, 'Review');
  const event = finalizeEvent({ ...template, tags: [...template.tags, ...Array.from({ length: 50 }, () => ['x', 'a'.repeat(2000)])] }, commenter);
  expect(parseApplicationComment(event, target)).toBeUndefined();
});
