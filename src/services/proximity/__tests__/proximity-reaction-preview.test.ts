import { conversations, messages, type Rumor } from '@/db/schema';
import { buildRumor } from '@/services/crypto/nip17-gift-wrap';
import { notificationService } from '@/services/notifications/notification.service';
import { filterNotifiableMessages } from '@/services/notifications/notification-filter';
import { buildNotificationContent } from '@/services/notifications/notification-policy';
import { takeNotificationEvents } from '@/services/notifications/notification-events.service';

import { decodeRumor, encodeMessageAck, encodeRumor, hexToBytes, ProximityErrorCode, ProximityMessageStatus } from '../proximity-protocol';
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
jest.mock('@/services/conversation/message-tail-cache', () => ({ emitMessageDeletion: jest.fn(), mergeStoredMessageIntoTail: jest.fn() }));

const { db, sqlite } = jest.requireMock('@/db/client') as ReturnType<
  typeof import('@/services/notifications/test-support/database').createNotificationDatabase
>;
const account = '11'.repeat(32);
const localIdentity = '22'.repeat(32);
const peer = '33'.repeat(32);
const endpoint = { phase: 'ready', peerPubkey: peer, selectedCapabilities: 1n };
const runtime = proximityService as unknown as {
  accountPubkey: string;
  identity: { proximityPubkey: string };
  handleMessage(context: typeof endpoint, payload: Uint8Array): Promise<void>;
  handleMessageAck(context: typeof endpoint & { endpointId: string }, payload: Uint8Array): Promise<void>;
  hasTrustedPeer(accountPubkey: string, peerPubkey: string): Promise<boolean>;
  sendMessageAck(context: typeof endpoint, id: string, status: ProximityMessageStatus): Promise<void>;
  drain(): Promise<void>;
  canonicalEndpoints: Map<string, string>;
  endpointContexts: Map<string, typeof endpoint & { endpointId: string }>;
  pendingMessages: Map<string, unknown>;
  ackTimers: Map<string, ReturnType<typeof setTimeout>>;
  retryTimer: ReturnType<typeof setTimeout> | null;
  retryAt: number;
  sendSecure(context: typeof endpoint, type: number, payload: Uint8Array): Promise<void>;
};

function reaction(target: string, content: string): Rumor {
  return buildRumor({
    kind: 7, content, created_at: 200, tags: [['p', localIdentity], ['e', target]],
  }, peer);
}

beforeEach(async () => {
  mockUserPresent = true;
  sqlite.exec('DELETE FROM outbox; DELETE FROM notification_events; DELETE FROM messages; DELETE FROM conversations;');
  sqlite.prepare("INSERT OR IGNORE INTO device_preferences (key,value,updated_at) VALUES ('notifications.enabled','1',1)").run();
  runtime.accountPubkey = account;
  runtime.identity = { proximityPubkey: localIdentity };
  jest.spyOn(runtime, 'hasTrustedPeer').mockResolvedValue(true);
  jest.spyOn(runtime, 'sendMessageAck').mockResolvedValue(undefined);
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
});

afterEach(() => {
  jest.restoreAllMocks();
  runtime.canonicalEndpoints.clear();
  runtime.endpointContexts.clear();
  runtime.pendingMessages.clear();
  for (const timer of runtime.ackTimers.values()) clearTimeout(timer);
  runtime.ackTimers.clear();
  if (runtime.retryTimer) clearTimeout(runtime.retryTimer);
  runtime.retryTimer = null;
  runtime.retryAt = 0;
  jest.useRealTimers();
});

it('authenticates Nearby reactions against the local proximity identity and uses both delivery paths', async () => {
  const ack = jest.mocked(runtime.sendMessageAck);
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

function retract(target: Rumor, at: number): Rumor {
  return buildRumor({
    kind: 5, content: '', created_at: at, tags: [['p', localIdentity], ['e', target.id], ['k', '7']],
  }, peer);
}

it('withdraws a Nearby reaction while keeping the original and newer preview', async () => {
  const earlier = reaction('aa'.repeat(32), '👍');
  const later = buildRumor({ ...reaction('aa'.repeat(32), '👎'), created_at: 201 }, peer);
  await runtime.handleMessage(endpoint, encodeRumor(earlier));
  await runtime.handleMessage(endpoint, encodeRumor(later));
  await runtime.handleMessage(endpoint, encodeRumor(retract(earlier, 202)));
  const preview = sqlite.prepare('SELECT reaction_preview_event_id, reaction_preview_pending, unread_count FROM conversations');
  expect(preview.get()).toEqual({ reaction_preview_event_id: later.id, reaction_preview_pending: 1, unread_count: 2 });
  const request = retract(later, 203);
  await runtime.handleMessage(endpoint, encodeRumor(request));
  await runtime.handleMessage(endpoint, encodeRumor(request));
  expect(jest.mocked(runtime.sendMessageAck).mock.calls.slice(-2).map(call => call[2])).toEqual([
    ProximityMessageStatus.Stored, ProximityMessageStatus.Duplicate,
  ]);
  expect(preview.get()).toEqual({ reaction_preview_event_id: later.id, reaction_preview_pending: 0, unread_count: 2 });
  const stored = sqlite.prepare('SELECT deleted FROM messages WHERE account_pubkey = ? AND id = ?');
  expect(stored.get(account, 'aa'.repeat(32))?.deleted).toBe(0);
  expect(stored.get(account, earlier.id)?.deleted).toBe(1);
  expect(stored.get(account, later.id)?.deleted).toBe(1);
  expect((await takeNotificationEvents(account, 'foreground')).events).toHaveLength(0);
});

it('does not surface a Nearby reaction whose valid retraction arrived first', async () => {
  const target = reaction('aa'.repeat(32), '👍');
  await runtime.handleMessage(endpoint, encodeRumor(retract(target, 201)));
  await runtime.handleMessage(endpoint, encodeRumor(target));
  expect(sqlite.prepare('SELECT deleted FROM messages WHERE id = ?').get(target.id)?.deleted).toBe(1);
  expect(sqlite.prepare('SELECT reaction_preview_event_id FROM conversations').get()?.reaction_preview_event_id).toBeNull();
  expect((await takeNotificationEvents(account, 'foreground')).events).toHaveLength(0);
});

it('queues a local Nearby retraction only for the owning identity', async () => {
  jest.spyOn(proximityService, 'assertConversationWritable').mockResolvedValue(runtime.identity as never);
  const paused = jest.spyOn(runtime, 'drain').mockResolvedValue(undefined);
  const theirs = reaction('aa'.repeat(32), '👍');
  await runtime.handleMessage(endpoint, encodeRumor(theirs));
  const mine = await proximityService.sendReaction({
    accountPubkey: account, peerPubkey: peer, targetMessageId: 'cc'.repeat(32), emoji: '👍',
  });

  const target = { accountPubkey: account, peerPubkey: peer };
  await proximityService.retractReaction({ ...target, reactionId: theirs.id });
  await proximityService.retractReaction({ ...target, reactionId: mine.id });
  await proximityService.retractReaction({ ...target, reactionId: mine.id });
  const jobs = sqlite.prepare('SELECT m.rumor, m.deleted FROM outbox o JOIN messages m ON m.id = o.message_id').all();
  expect(jobs).toHaveLength(1);
  expect(jobs[0].deleted).toBe(1);
  expect(JSON.parse(String(jobs[0].rumor))).toMatchObject({
    kind: 5, pubkey: localIdentity, tags: expect.arrayContaining([['e', mine.id], ['k', '7'], ['p', peer]]),
  });
  expect(sqlite.prepare('SELECT deleted FROM messages WHERE id = ?').get(mine.id)?.deleted).toBe(1);
  expect(sqlite.prepare('SELECT deleted FROM messages WHERE id = ?').get(theirs.id)?.deleted).toBe(0);

  const ordinary = await proximityService.sendMessage({ ...target, content: 'Still delivered to an older client' });
  sqlite.prepare('INSERT INTO device_preferences (key,value,updated_at) VALUES (?, ?, 0)')
    .run(`proximity.enabled.${account}`, '1');
  const endpointId = 'older-client';
  runtime.canonicalEndpoints.set(peer, endpointId);
  const legacyContext = { ...endpoint, endpointId };
  runtime.endpointContexts.set(endpointId, legacyContext);
  const sent = jest.spyOn(runtime, 'sendSecure').mockResolvedValue();
  paused.mockRestore();
  await runtime.drain();
  const retractionId = (JSON.parse(String(jobs[0].rumor)) as Rumor).id;
  expect(sent.mock.calls.map(([, , payload]) => decodeRumor(payload).id)).toEqual([retractionId, ordinary.id]);
  const status = sqlite.prepare('SELECT status FROM outbox WHERE message_id = ?');
  expect(status.get(mine.id)).toBeUndefined();
  expect(status.get(retractionId)).toEqual({ status: 'awaiting_ack' });

  // A later drain must still send chat while the peer has ignored the retraction.
  const pausedAgain = jest.spyOn(runtime, 'drain').mockResolvedValue();
  await runtime.handleMessageAck(legacyContext, encodeMessageAck({
    rumorId: hexToBytes(ordinary.id), status: ProximityMessageStatus.Stored, errorCode: ProximityErrorCode.None,
  }));
  const followup = await proximityService.sendMessage({ ...target, content: 'Chat can keep going' });
  pausedAgain.mockRestore();
  await runtime.drain();
  expect(sent.mock.calls.map(([, , payload]) => decodeRumor(payload).id)).toEqual([
    retractionId, ordinary.id, followup.id,
  ]);
});

async function sendQueuedRetractions(emojis: string[]) {
  jest.spyOn(proximityService, 'assertConversationWritable').mockResolvedValue(runtime.identity as never);
  const paused = jest.spyOn(runtime, 'drain').mockResolvedValue();
  const target = { accountPubkey: account, peerPubkey: peer };
  for (const emoji of emojis) {
    const mine = await proximityService.sendReaction({ ...target, targetMessageId: 'cc'.repeat(32), emoji });
    await proximityService.retractReaction({ ...target, reactionId: mine.id });
  }
  const ids = sqlite.prepare(`SELECT m.id FROM messages m JOIN outbox o ON o.message_id = m.id
    WHERE m.kind = 5 ORDER BY m.order_at ASC, m.id DESC`).all().map(row => String(row.id));
  sqlite.prepare('INSERT OR REPLACE INTO device_preferences (key,value,updated_at) VALUES (?, ?, 0)')
    .run(`proximity.enabled.${account}`, '1');
  const context = { ...endpoint, endpointId: 'ack-client' };
  runtime.canonicalEndpoints.set(peer, context.endpointId);
  runtime.endpointContexts.set(context.endpointId, context);
  const sent = jest.spyOn(runtime, 'sendSecure').mockResolvedValue();
  paused.mockRestore();
  await runtime.drain();
  return { ids, context, sent };
}

it('advances the retraction queue after a permanent rejection', async () => {
  const { ids: [first, second], context, sent } = await sendQueuedRetractions(['👍', '👎']);
  expect(sent.mock.calls.map(([, , payload]) => decodeRumor(payload).id)).toEqual([first]);
  const drain = jest.spyOn(runtime, 'drain');
  await runtime.handleMessageAck(context, encodeMessageAck({
    rumorId: hexToBytes(first), status: ProximityMessageStatus.Rejected, errorCode: ProximityErrorCode.AccessDenied,
  }));
  expect(drain).toHaveBeenCalledTimes(1);
  await drain.mock.results[0].value;
  expect(sent.mock.calls.map(([, , payload]) => decodeRumor(payload).id)).toEqual([first, second]);
  const status = sqlite.prepare('SELECT status FROM outbox WHERE message_id = ?');
  expect(status.get(first)).toEqual({ status: 'failed' });
  expect(status.get(second)).toEqual({ status: 'awaiting_ack' });
  expect(runtime.ackTimers.has(first)).toBe(false);
});

it('keeps the acknowledgement timeout when persisting it fails', async () => {
  jest.useFakeTimers({ doNotFake: ['setImmediate'] });
  const { ids: [id], context } = await sendQueuedRetractions(['👍']);
  const attempt = runtime.pendingMessages.get(id);
  const timeout = runtime.ackTimers.get(id);
  jest.spyOn(db, 'transaction').mockRejectedValueOnce(new Error('Temporary transaction failure'));
  const warning = jest.spyOn(console, 'warn').mockImplementation(() => {});
  await runtime.handleMessageAck(context, encodeMessageAck({
    rumorId: hexToBytes(id), status: ProximityMessageStatus.Stored, errorCode: ProximityErrorCode.None,
  }));

  const status = sqlite.prepare('SELECT status FROM outbox WHERE message_id = ?');
  expect(warning).toHaveBeenCalledWith('[nearby] Could not store message acknowledgement.', expect.any(Error));
  expect(status.get(id)).toEqual({ status: 'awaiting_ack' });
  expect(runtime.pendingMessages.get(id)).toBe(attempt);
  expect(runtime.ackTimers.get(id)).toBe(timeout);
  await jest.advanceTimersByTimeAsync(12_000);
  expect(status.get(id)).toEqual({ status: 'queued' });
  expect(runtime.pendingMessages.has(id)).toBe(false);
  expect(runtime.ackTimers.has(id)).toBe(false);
});

afterAll(() => sqlite.close());
