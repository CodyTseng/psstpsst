import { useEffect } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { conversations, messages, type Rumor } from '@/db/schema';
import { recordNotificationEvent } from '@/services/notifications/notification-events.service';
import { useIncomingMessageArrival } from '../use-message-arrivals';

jest.mock('@/db/client', () => {
  const { createNotificationDatabase } = jest.requireActual('@/services/notifications/test-support/database');
  return createNotificationDatabase();
});
jest.mock('@/lib/platform', () => ({ IS_IOS: false }));
let mockChange: (event: { external?: boolean; tableName?: string }) => void;
let mockPresent = true;
jest.mock('@/platform', () => ({ platform: {
  database: { addChangeListener: (listener: typeof mockChange) => { mockChange = listener; return () => {}; } },
  notifications: { shouldNotifyNow: () => !mockPresent, addUserReturnedListener: () => () => {} },
  appState: { addChangeListener: () => () => {} },
} }));
const fixture = jest.requireMock('@/db/client') as ReturnType<typeof import('@/services/notifications/test-support/database').createNotificationDatabase>;
const ACCOUNT = 'self';
let observed: ReturnType<typeof useIncomingMessageArrival>;
let renderer: ReactTestRenderer;
function Harness({ ready = true, quiet = false }: { ready?: boolean; quiet?: boolean }) {
  const arrival = useIncomingMessageArrival(ACCOUNT, { ready, enabled: true, quietRequests: quiet,
    chatsVisible: true, activeConversationKey: null });
  useEffect(() => { observed = arrival; }, [arrival]);
  return null;
}
async function render(ready = true, quiet = false) {
  await act(async () => {
    if (renderer) renderer.update(<Harness ready={ready} quiet={quiet} />);
    else renderer = create(<Harness ready={ready} quiet={quiet} />);
  });
  await settle();
}
async function settle() {
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 15)); });
}
async function extensionWrite(eligible = true, options: { id?: string; peer?: string; orderAt?: number } = {}) {
  const id = options.id ?? 'first';
  const peer = options.peer ?? 'peer';
  const orderAt = options.orderAt ?? 100000;
  const createdAt = Math.floor(orderAt / 1000);
  const rumor = { id, pubkey: peer, kind: 14, content: 'hello', created_at: createdAt, tags: [] } as Rumor;
  // A separately constructed handle has no shared JS arrival state with the hook.
  await fixture.createHandle().transaction(async tx => {
    await tx.insert(conversations).values({ accountPubkey: ACCOUNT, conversationKey: peer,
      createdAt, createdOrderAt: orderAt, updatedAt: createdAt, updatedOrderAt: orderAt,
      lastMessageId: id, lastMessageAt: createdAt, lastMessageOrderAt: orderAt, unreadCount: 1 });
    await tx.insert(messages).values({ accountPubkey: ACCOUNT, conversationKey: peer, id,
      senderPubkey: peer, kind: 14, content: 'hello', createdAt, orderAt, tags: [], rumor });
    await recordNotificationEvent(tx, { accountPubkey: ACCOUNT, conversationKey: peer, rumor,
      before: null, after: { deleted: false, muted: false, hasReplied: false, unreadCount: 1, lastMessageId: id },
      eligible, incoming: true, userPresent: true });
  });
}
beforeEach(() => {
  fixture.sqlite.exec('DELETE FROM notification_events; DELETE FROM messages; DELETE FROM conversations; DELETE FROM device_preferences; DELETE FROM accounts;');
  fixture.sqlite.prepare("INSERT INTO accounts (pubkey, signer_type, added_at) VALUES (?, 'generated', 1)").run(ACCOUNT);
  observed = null;
  mockPresent = true;
});
afterEach(() => { act(() => renderer?.unmount()); renderer = undefined!; });
afterAll(() => fixture.sqlite.close());

it('delivers an extension-owned foreground arrival once after external invalidation', async () => {
  await render();
  await extensionWrite();
  expect(observed).toBeNull();
  mockChange({ external: true });
  await settle();
  expect(observed?.conversation.lastMessageId).toBe('first');
  const first = observed;
  expect(fixture.sqlite.prepare('SELECT id FROM notification_events').all()).toHaveLength(0);
  mockChange({ external: true });
  await settle();
  expect(observed).toBe(first);
});
it('retains the event until preferences are resolved without waiting for list queries', async () => {
  await render(false);
  await extensionWrite();
  expect(fixture.sqlite.prepare('SELECT id FROM notification_events').all()).toHaveLength(1);
  await render(true);
  expect(observed?.conversation.lastMessageId).toBe('first');
});
it('keeps external history imports silent while the host is mounted', async () => {
  await render();
  await extensionWrite(false);
  mockChange({ external: true });
  await settle();
  expect(observed).toBeNull();
});
it('consumes suppressed arrivals without replaying them when quiet mode ends', async () => {
  await render(true, true);
  await extensionWrite();
  mockChange({ external: true });
  await settle();
  await render(true, false);
  expect(observed).toBeNull();
  expect(fixture.sqlite.prepare('SELECT id FROM notification_events').all()).toHaveLength(0);
});

it.each([0, 128])('publishes the newest arrival across the whole batch when it is inserted at index %s', async newestIndex => {
  await render();
  for (let index = 0; index < 129; index++) {
    await extensionWrite(true, { id: `message-${index}`, peer: `peer-${index}`,
      orderAt: index === newestIndex ? 200000 : 100000 + index });
  }
  mockChange({ external: true });
  await settle();
  expect(observed?.conversation.lastMessageId).toBe(`message-${newestIndex}`);
  expect(fixture.sqlite.prepare('SELECT id FROM notification_events').all()).toHaveLength(0);
});
