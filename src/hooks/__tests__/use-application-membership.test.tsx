import { useEffect } from 'react';
import { naddrEncode, neventEncode } from 'nostr-tools/nip19';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { useApplicationMembership } from '../use-application-membership';
import type { ExploreEntry } from '@/services/explore/model';

type Snapshot = { dirty: boolean; draft: string[][] | null; snapshot: { eventId: string; tags: string[][] } | null };
let mockSaved: { data: Snapshot[]; isResolved: boolean; error?: Error };
let mockLocal: { data: { desktopPosition: number | null }[]; isResolved: boolean; error?: Error };
jest.mock('@/db/client', () => ({ db: { select: () => ({ from: (table: unknown) => ({ where: () => ({ limit: () => ({ table }) }) }) }) } }));
jest.mock('@/db/use-live-query', () => ({ useLiveQuery: jest.fn((query: { table: unknown }) =>
  query.table === jest.requireActual('@/db/schema').localApplications ? mockLocal : mockSaved) }));

let result: ReturnType<typeof useApplicationMembership>;
function Harness({ account = 'account', entry = { key: 'https://example.com/', kind: 'website' } }: {
  account?: string; entry?: Pick<ExploreEntry, 'key' | 'kind'>;
}) {
  const current = useApplicationMembership(account, entry);
  useEffect(() => { result = current; }, [current]);
  return null;
}
let renderer: ReactTestRenderer;
beforeEach(() => {
  mockSaved = { data: [], isResolved: false };
  mockLocal = { data: [], isResolved: false };
});
afterEach(() => act(() => renderer?.unmount()));

it('resolves existing membership from the local snapshot without visiting Explore', () => {
  act(() => { renderer = create(<Harness />); });
  expect(result.added).toBeUndefined();
  mockSaved = { isResolved: true, data: [{ dirty: false, draft: null,
    snapshot: { eventId: 'event', tags: [['r', 'https://example.com/']] } }] };
  act(() => { renderer.update(<Harness />); });
  expect(result.added).toBe(true);
  mockSaved = { isResolved: true, data: [] };
  act(() => { renderer.update(<Harness />); });
  expect(result.added).toBe(false);
});

it('uses pending local additions and removals before the signed snapshot', () => {
  mockSaved = { isResolved: true, data: [{ dirty: true, draft: [],
    snapshot: { eventId: 'event', tags: [['r', 'https://example.com/']] } }] };
  act(() => { renderer = create(<Harness />); });
  expect(result.added).toBe(false);
  mockSaved = { isResolved: true, data: [{ dirty: true, draft: [['r', 'https://example.com/']], snapshot: null }] };
  act(() => { renderer.update(<Harness />); });
  expect(result.added).toBe(true);
});

it('does not expose retained membership while an account replacement is unresolved', () => {
  mockSaved = { isResolved: true, data: [{ dirty: false, draft: null,
    snapshot: { eventId: 'event', tags: [['r', 'https://example.com/']] } }] };
  act(() => { renderer = create(<Harness />); });
  expect(result.added).toBe(true);
  mockSaved = { ...mockSaved, isResolved: false };
  act(() => { renderer.update(<Harness account="other" />); });
  expect(result.added).toBeUndefined();
  mockSaved = { data: [], isResolved: true };
  act(() => { renderer.update(<Harness account="other" />); });
  expect(result.added).toBe(false);
});

it('resolves local app membership from its account-owned row', () => {
  const entry = { key: 'local~notes', kind: 'napp' as const };
  act(() => { renderer = create(<Harness entry={entry} />); });
  expect(result.added).toBeUndefined();
  mockLocal = { isResolved: true, data: [{ desktopPosition: 0 }] };
  act(() => { renderer.update(<Harness entry={entry} />); });
  expect(result.added).toBe(true);
  mockLocal = { isResolved: true, data: [{ desktopPosition: null }] };
  act(() => { renderer.update(<Harness entry={entry} />); });
  expect(result.added).toBe(false);
});

it('keeps failures distinct from a definite non-member', () => {
  mockSaved = { data: [], isResolved: false, error: new Error('offline') };
  act(() => { renderer = create(<Harness />); });
  expect(result.added).toBeUndefined();
  expect(result.error?.message).toBe('offline');
});

it.each([
  { key: naddrEncode({ kind: 35129, pubkey: 'b'.repeat(64), identifier: 'composer' }), tag: ['a', `35129:${'b'.repeat(64)}:composer`, 'wss://relay.example/'] },
  { key: neventEncode({ id: 'd'.repeat(64) }), tag: ['e', 'd'.repeat(64), '', 'b'.repeat(64)] },
])('resolves saved napplet references from their stable identity: $key', ({ key, tag }) => {
  mockSaved = { isResolved: true, data: [{ dirty: false, draft: null, snapshot: { eventId: 'event', tags: [tag] } }] };
  act(() => { renderer = create(<Harness entry={{ key, kind: 'napplet' }} />); });
  expect(result.added).toBe(true);
});
