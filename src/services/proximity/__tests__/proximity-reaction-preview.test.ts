import { conversations, messages, type Rumor } from '@/db/schema';
import { buildRumor } from '@/services/crypto/nip17-gift-wrap';
import { notificationService } from '@/services/notifications/notification.service';
import { filterNotifiableMessages } from '@/services/notifications/notification-filter';
import { buildNotificationContent } from '@/services/notifications/notification-policy';
import { takeNotificationEvents } from '@/services/notifications/notification-events.service';

import { encodeRumor, ProximityMessageStatus } from '../proximity-protocol';
import { proximityService } from '../proximity-runtime.service';

jest.mock('@/db/client', () => {
  const { createNotificationDatabase } = jest.requireActual('@/services/notifications/test-support/database');
  return createNotificationDatabase();
});
let mockUserPresent = true;
jest.mock('@/platform', () => ({
  platform: {
    notifications: { shouldNotifyNow: () => !mockUserPresent },
    localization: { preferredLanguageTag: () => 'en' },
  },
}));
jest.mock('@/services/notifications/notification.service', () => ({
  notificationService: { notifyNewRumors: jest.fn(async () => {}) },
}));
jest.mock('@/services/conversation/message-tail-cache', () => ({ mergeStoredMessageIntoTail: jest.fn() }));

const { db, sqlite } = jest.requireMock('@/db/client') as ReturnType<
  typeof import('@/services/notifications/test-support/database').createNotificationDatabase
>;
const account = '11'.repeat(32);
const localIdentity = '22'.repeat(32);
const peer = '33'.repeat(32);
const endpoint = { phase: 'ready', peerPubkey: peer };
const runtime = proximityService as unknown as {
  accountPubkey: string;
  identity: { proximityPubkey: string };
  handleMessage(context: typeof endpoint, payload: Uint8Array): Promise<void>;
  hasTrustedPeer(accountPubkey: string, peerPubkey: string): Promise<boolean>;
  sendMessageAck(context: typeof endpoint, id: string, status: ProximityMessageStatus): Promise<void>;
};

function reaction(target: string, content: string): Rumor {
  return buildRumor({
    kind: 7, content, created_at: 200, tags: [['p', localIdentity], ['e', target]],
  }, peer);
}

it('authenticates Nearby reactions against the local proximity identity and uses both delivery paths', async () => {
  sqlite.prepare("INSERT INTO device_preferences (key,value,updated_at) VALUES ('notifications.enabled','1',1)").run();
  runtime.accountPubkey = account;
  runtime.identity = { proximityPubkey: localIdentity };
  jest.spyOn(runtime, 'hasTrustedPeer').mockResolvedValue(true);
  const ack = jest.spyOn(runtime, 'sendMessageAck').mockResolvedValue(undefined);
  await db.insert(conversations).values({
    accountPubkey: account, conversationKey: peer, deliveryKind: 'proximity',
    proximityAccountPubkey: localIdentity, name: 'Desk peer', createdAt: 100, createdOrderAt: 100000,
    updatedAt: 100, updatedOrderAt: 100000, hasReplied: true, unreadCount: 2,
    lastMessageId: 'aa'.repeat(32), lastMessageAt: 100, lastMessageOrderAt: 100000,
  });
  for (const [id, senderPubkey] of [['aa', localIdentity], ['bb', account], ['cc', peer]]) {
    const rumor = {
      id: id.repeat(32), pubkey: senderPubkey, kind: 14, content: 'message', created_at: 100, tags: [],
    };
    await db.insert(messages).values({
      accountPubkey: account, conversationKey: peer, id: rumor.id, senderPubkey, kind: rumor.kind,
      content: rumor.content, createdAt: 100, orderAt: 100000, tags: [], rumor,
    });
  }
  for (const target of ['bb', 'cc']) {
    await runtime.handleMessage(endpoint, encodeRumor(reaction(target.repeat(32), '👍')));
  }
  expect((await takeNotificationEvents(account, 'foreground')).events).toHaveLength(0);

  const foreground = reaction('aa'.repeat(32), '👍');
  await runtime.handleMessage(endpoint, encodeRumor(foreground));
  await runtime.handleMessage(endpoint, encodeRumor(foreground));
  expect(ack.mock.calls.map(call => call[2])).toEqual([
    ProximityMessageStatus.Stored, ProximityMessageStatus.Stored, ProximityMessageStatus.Stored, ProximityMessageStatus.Duplicate,
  ]);
  expect((await takeNotificationEvents(account, 'foreground')).events.map(row => row.message.id)).toEqual([foreground.id]);

  mockUserPresent = false;
  const template = reaction('aa'.repeat(32), '👎');
  const background = buildRumor({ ...template, created_at: 201, tags: [...template.tags, ['h', 'unrelated-group']] }, peer);
  await runtime.handleMessage(endpoint, encodeRumor(background));
  await new Promise(resolve => setImmediate(resolve));
  expect(notificationService.notifyNewRumors).toHaveBeenCalledWith([background], { accountPubkey: account, deliveryKind: 'proximity' });
  const candidates = await filterNotifiableMessages([], account, 'proximity');
  expect(candidates.map(row => row.rumor.id)).toEqual([background.id]);
  const [candidate] = candidates;
  expect(await buildNotificationContent(candidate.rumor, 1, account, {
    conversation: candidate.conversation,
    preferences: { showSender: true, showMessageContent: true },
  })).toMatchObject({
    title: 'Desk peer',
    body: 'Reacted to your message with 👎',
    communication: { conversationId: `${account}:${peer}`, groupName: undefined },
  });
  expect(sqlite.prepare(`
    SELECT unread_count, updated_order_at, last_message_id, reaction_preview_event_id
    FROM conversations WHERE account_pubkey = ? AND conversation_key = ?
  `).get(account, peer)).toEqual({
    unread_count: 2, updated_order_at: 100000, last_message_id: 'aa'.repeat(32),
    reaction_preview_event_id: background.id,
  });
});

afterAll(() => sqlite.close());
