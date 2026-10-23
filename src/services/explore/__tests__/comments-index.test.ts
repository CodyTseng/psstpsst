import type { Event } from 'nostr-tools';
import { CommentIndex, MAX_THREAD_COMMENTS } from '../comments-index';
import type { ApplicationComment } from '../comments-protocol';

const id = (value: number) => value.toString(16).padStart(64, '0');
const comment = (value: number, parent?: number): ApplicationComment => ({
  event: { id: id(value), created_at: value, content: `Comment ${value}`, pubkey: 'a'.repeat(64),
    tags: parent === undefined ? [] : [['p', 'a'.repeat(64)], ['e', id(parent)]] } as Event,
  parentId: parent === undefined ? undefined : id(parent),
});

it('orders root comments newest first and replies chronologically without duplicate rows', () => {
  const index = new CommentIndex();
  for (const item of [comment(1), comment(5), comment(4, 1), comment(3, 1), comment(2, 1), comment(3, 1)]) index.add(item);
  expect(index.rows().map(row => [row.comment.event.id, row.depth])).toEqual([
    [id(5), 0], [id(1), 0], [id(2), 1], [id(3), 1], [id(4), 1],
  ]);
});

it('keeps replies visible before their parent arrives, then attaches them to the thread', () => {
  const index = new CommentIndex();
  index.add(comment(2, 1));
  expect(index.rows()[0].depth).toBe(0);
  index.add(comment(1));
  expect(index.rows().map(row => row.depth)).toEqual([0, 1]);
  expect(index.rows()[0].hasReplies).toBe(true);
});

it('bounds the visible window and nesting even when a long chain loses its oldest ancestors', () => {
  const index = new CommentIndex();
  for (let i = 1; i <= MAX_THREAD_COMMENTS + 10; i++) index.add(comment(i, i > 1 ? i - 1 : undefined));
  const rows = index.rows();
  expect(index.size).toBe(MAX_THREAD_COMMENTS);
  expect(rows).toHaveLength(MAX_THREAD_COMMENTS);
  expect(rows[0].comment.event.id).toBe(id(11));
  expect(Math.max(...rows.map(row => row.depth))).toBe(3);
});

it('rejects incorrect parent-author tags even when the parent arrives after its reply', () => {
  const index = new CommentIndex();
  const wrong = comment(2, 1);
  wrong.event.tags = [['p', 'b'.repeat(64)], ['e', id(1)]];
  index.add(wrong);
  index.add(comment(1));
  expect(index.rows().map(row => row.comment.event.id)).toEqual([id(1)]);
});

it('connects reply branches while continuing ancestor guides only through remaining siblings', () => {
  const index = new CommentIndex();
  for (const item of [comment(1), comment(2, 1), comment(3, 2), comment(4, 1)]) index.add(item);
  expect(index.rows().map(({ depth, guideDepths, parentDepth, continuesParent }) =>
    ({ depth, guideDepths, parentDepth, continuesParent }))).toEqual([
    { depth: 0, guideDepths: [], parentDepth: undefined, continuesParent: false },
    { depth: 1, guideDepths: [], parentDepth: 0, continuesParent: true },
    { depth: 2, guideDepths: [0], parentDepth: 1, continuesParent: false },
    { depth: 1, guideDepths: [], parentDepth: 0, continuesParent: false },
  ]);
});
