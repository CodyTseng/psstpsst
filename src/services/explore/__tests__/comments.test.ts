import { finalizeEvent, generateSecretKey, getPublicKey, type Event, type EventTemplate } from 'nostr-tools';
import { ApplicationCommentsSession, APPLICATION_COMMENT_RELAYS } from '../comments';
import { commentTemplate, type CommentTarget } from '../comments-protocol';
import { NappletNetwork } from '@/services/napplet/network';
import { canReceiveForAccount } from '@/services/account/account-receive-guard';
import { getActiveAccountPubkey } from '@/services/account/account.service';
import { nappletLifecycle } from '@/services/napplet/lifecycle';

jest.mock('@/services/napplet/network', () => ({ NappletNetwork: jest.fn() }));
jest.mock('@/services/account/account-receive-guard', () => ({ canReceiveForAccount: jest.fn() }));
jest.mock('@/services/account/account.service', () => ({ getActiveAccountPubkey: jest.fn() }));
const secret = generateSecretKey(), account = getPublicKey(secret);
const publisher = getPublicKey(generateSecretKey());
const target: CommentTarget = { key: `A:35130:${publisher}:app`, tag: 'A', value: `35130:${publisher}:app`, kind: '35130', author: publisher, eventId: 'a'.repeat(64) };
const query = jest.fn(), sign = jest.fn(), publish = jest.fn(), routes = jest.fn(), destroy = jest.fn();
const subscribe = jest.fn();
let deliver: (event: Event) => void;
let session: ApplicationCommentsSession;
const flush = () => new Promise<void>(resolve => setTimeout(resolve, 0));
async function until(condition: () => boolean) {
  for (let i = 0; i < 40 && !condition(); i++) await flush();
  expect(condition()).toBe(true);
}
beforeEach(() => {
  jest.clearAllMocks();
  query.mockReset().mockResolvedValue({ events: [], incomplete: false });
  sign.mockReset().mockImplementation(async (template: EventTemplate) => finalizeEvent(template, secret));
  publish.mockReset().mockResolvedValue({ 'wss://relay.example/': true });
  routes.mockReset().mockResolvedValue(['wss://relay.example/']);
  subscribe.mockReset().mockImplementation((options: { onEvent(event: Event): void }) => { deliver = options.onEvent; return () => {}; });
  jest.mocked(canReceiveForAccount).mockResolvedValue(true);
  jest.mocked(getActiveAccountPubkey).mockResolvedValue(account);
  jest.mocked(NappletNetwork).mockImplementation(() => ({
    query, sign, publish, routes, destroy, subscribe,
  }) as unknown as NappletNetwork);
  session = new ApplicationCommentsSession(account, target);
});
afterEach(() => session.stop());

it('loads verified comments and deduplicates live arrivals', async () => {
  const event = finalizeEvent(commentTemplate(target, 'Review'), secret);
  query.mockResolvedValueOnce({ events: [event, { ...event, content: 'forged' }], incomplete: false });
  session.start(); await session.load();
  deliver(event);
  await flush(); await flush();
  expect(session.store.getState().rows.map(row => row.comment.event.id)).toEqual([event.id]);
  expect(session.store.getState()).toMatchObject({ loaded: true, loading: false, error: false, hasMore: false });
});

it('shows verified partial results without an error or repeated pagination', async () => {
  const event = finalizeEvent(commentTemplate(target, 'Review'), secret);
  query.mockResolvedValueOnce({ events: [event], incomplete: true });
  session.start(); await session.load();
  expect(session.store.getState().rows.map(row => row.comment.event.id)).toEqual([event.id]);
  expect(session.store.getState()).toMatchObject({ loaded: true, loading: false, error: false, hasMore: false });
  await session.load();
  expect(query).toHaveBeenCalledTimes(1);
});

it('accepts a successful empty response despite other relays failing', async () => {
  query.mockResolvedValueOnce({ events: [], incomplete: true });
  session.start(); await session.load();
  expect(session.store.getState()).toMatchObject({ rows: [], loaded: true, error: false, hasMore: false });
});

it('retains retry feedback when all relays fail without returning events', async () => {
  query.mockResolvedValueOnce({ events: [], incomplete: true, error: 'network-error' });
  session.start(); await session.load();
  expect(session.store.getState()).toMatchObject({ rows: [], error: true });
  const event = finalizeEvent(commentTemplate(target, 'Review'), secret);
  query.mockResolvedValueOnce({ events: [event], incomplete: true });
  await session.load(true);
  expect(session.store.getState()).toMatchObject({ loaded: true, error: false });
  expect(session.store.getState().rows).toHaveLength(1);
});

it('keeps pagination available for a full partial page', async () => {
  const events = Array.from({ length: 100 }, (_, i) => finalizeEvent(commentTemplate(target, `Review ${i}`), secret));
  query.mockResolvedValueOnce({ events, incomplete: true });
  session.start(); await session.load();
  expect(session.store.getState()).toMatchObject({ loaded: true, error: false, hasMore: true });
});

it('signs with the selected account and adds its review only after relay acknowledgement', async () => {
  session.start(); await session.load();
  let acknowledge!: (result: Record<string, boolean>) => void;
  publish.mockImplementationOnce(() => new Promise(resolve => { acknowledge = resolve; }));
  const posting = session.post('Useful app');
  await until(() => publish.mock.calls.length === 1);
  expect(session.store.getState().rows).toHaveLength(0);
  acknowledge({ 'wss://relay.example/': true });
  const event = await posting;
  expect(event.pubkey).toBe(account);
  expect(routes).toHaveBeenCalledTimes(1);
  expect(routes).toHaveBeenCalledWith([publisher], 'read', true, expect.anything());
  const relays = [...new Set(['wss://relay.example/', ...APPLICATION_COMMENT_RELAYS])];
  expect(query.mock.calls[0][0]).toEqual(relays);
  expect(subscribe.mock.calls[0][0].relays).toEqual(relays);
  expect(publish.mock.calls[0][1]).toEqual(relays);
  expect(session.store.getState().rows[0].comment.event.id).toBe(event.id);
});

it('deduplicates publisher read relays against discovery relays for reads and publication', async () => {
  routes.mockResolvedValue([APPLICATION_COMMENT_RELAYS[0], 'wss://publisher.example/']);
  session.start(); await session.load();
  await session.post('Review');
  const relays = [...new Set([APPLICATION_COMMENT_RELAYS[0], 'wss://publisher.example/', ...APPLICATION_COMMENT_RELAYS])];
  expect(query.mock.calls[0][0]).toEqual(relays);
  expect(publish.mock.calls[0][1]).toEqual(relays);
  expect(subscribe).toHaveBeenCalledTimes(1);
});

it('uses discovery relays when the publisher has no read relays', async () => {
  routes.mockRejectedValue(new Error('recipient-relays-unavailable'));
  session.start(); await session.load();
  await session.post('Review');
  expect(query.mock.calls[0][0]).toEqual(APPLICATION_COMMENT_RELAYS);
  expect(publish.mock.calls[0][1]).toEqual(APPLICATION_COMMENT_RELAYS);
  expect(session.store.getState().error).toBe(false);
});

it('uses discovery relays for websites without inventing a publisher', async () => {
  session = new ApplicationCommentsSession(account, { key: 'I:https://example.com/', tag: 'I', value: 'https://example.com/', kind: 'web' });
  session.start(); await session.load();
  await session.post('Review');
  expect(routes).not.toHaveBeenCalled();
  expect(query.mock.calls[0][0]).toEqual(APPLICATION_COMMENT_RELAYS);
  expect(publish.mock.calls[0][1]).toEqual(APPLICATION_COMMENT_RELAYS);
});

it('reuses the signed event on publication failure rather than publishing a duplicate review', async () => {
  session.start(); await session.load();
  publish.mockResolvedValueOnce({ 'wss://relay.example/': false });
  await expect(session.post('Review')).rejects.toThrow('publish-failed');
  const event = await session.post('Review');
  expect(sign).toHaveBeenCalledTimes(1);
  expect(publish.mock.calls[0][0].id).toBe(event.id);
  expect(publish.mock.calls[1][0].id).toBe(event.id);
});

it('rejects unavailable reply parents and removed accounts before signing', async () => {
  session.start(); await session.load();
  await expect(session.post('Reply', 'b'.repeat(64))).rejects.toThrow('reply-unavailable');
  jest.mocked(canReceiveForAccount).mockResolvedValue(false);
  await expect(session.post('Review')).rejects.toThrow('account-unavailable');
  expect(sign).not.toHaveBeenCalled();
});

it('discards a signature finishing after account deactivation', async () => {
  session.start(); await session.load();
  let finish!: (event: Event) => void;
  sign.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const posting = session.post('Review');
  const rejected = expect(posting).rejects.toThrow('session-closed');
  await until(() => sign.mock.calls.length === 1);
  nappletLifecycle.deactivate();
  finish(finalizeEvent(sign.mock.calls[0][0], secret));
  await rejected;
  expect(publish).not.toHaveBeenCalled();
});

it('does not publish after the active account changes during signing', async () => {
  session.start(); await session.load();
  sign.mockImplementationOnce(async (template: EventTemplate) => {
    jest.mocked(getActiveAccountPubkey).mockResolvedValue(publisher);
    return finalizeEvent(template, secret);
  });
  await expect(session.post('Review')).rejects.toThrow('account-unavailable');
  expect(publish).not.toHaveBeenCalled();
});

it('widens an inclusive timestamp boundary when the next page contains only duplicates', async () => {
  const now = Math.floor(Date.now() / 1000);
  const events = Array.from({ length: 101 }, (_, i) => finalizeEvent({ ...commentTemplate(target, `Review ${i}`), created_at: now }, secret));
  query.mockResolvedValueOnce({ events: events.slice(0, 100), incomplete: false })
    .mockResolvedValueOnce({ events: events.slice(0, 100), incomplete: false })
    .mockResolvedValueOnce({ events, incomplete: false });
  session.start(); await session.load();
  await session.load();
  expect(query.mock.calls[1][1][0]).toMatchObject({ until: now, limit: 100 });
  expect(query.mock.calls[2][1][0]).toMatchObject({ until: now, limit: 200 });
  expect(session.store.getState().rows).toHaveLength(101);
});

it('looks beyond a full page of malformed root metadata before declaring a discussion empty', async () => {
  const malformed = Array.from({ length: 100 }, (_, i) => {
    const template = commentTemplate(target, `Wrong root kind ${i}`);
    return finalizeEvent({ ...template, tags: template.tags.map(tag => tag[0] === 'K' ? ['K', '0'] : tag) }, secret);
  });
  const valid = finalizeEvent(commentTemplate(target, 'Valid review'), secret);
  query.mockResolvedValueOnce({ events: malformed, incomplete: false })
    .mockResolvedValueOnce({ events: [...malformed, valid], incomplete: false });
  session.start(); await session.load();
  expect(query.mock.calls[1][1][0].limit).toBe(200);
  expect(session.store.getState().rows.map(row => row.comment.event.id)).toEqual([valid.id]);
});
