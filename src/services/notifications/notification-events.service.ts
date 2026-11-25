import { and, asc, desc, eq, gte, inArray, lt, lte } from 'drizzle-orm';

import { db, type Database } from '@/db/client';
import { conversations, devicePreferences, messages, notificationEvents, type Rumor } from '@/db/schema';
import { IS_IOS } from '@/lib/platform';
import { isMessageOrderNewer } from '@/lib/nostr/message-order';
import { reactionTargetsOwnVisibleMessage } from '@/services/conversation/reaction-target';
import {
  DND_WINDOW_KEY, ENABLED_KEY, QUIET_MESSAGE_REQUESTS_KEY, UNREAD_INDICATORS_KEY,
  isMinuteInDndWindow, parseDndWindow,
} from './notification-prefs';

export type NotificationTarget = 'foreground' | 'system';
export type NotificationKind = 'message' | 'request' | 'reaction';
export type NotificationConversationState = Pick<typeof conversations.$inferSelect,
  'deleted' | 'hasReplied' | 'lastMessageId' | 'unreadCount' | 'muted'>;
export type ClaimedNotificationEvent = {
  event: typeof notificationEvents.$inferSelect;
  conversation: typeof conversations.$inferSelect;
  message: typeof messages.$inferSelect;
};

const BATCH_SIZE = 128;
const EVENT_TTL_MS = 60_000;

/** Shared business rule. Deletion restores unread requests, never their first alert. */
export function notificationKindForTransition(input: {
  before: NotificationConversationState | null;
  after: NotificationConversationState;
  eligible: boolean;
  incoming: boolean;
  messageKind: number;
  reactionToOwnMessage?: boolean;
}): NotificationKind | null {
  const { before, after, eligible, incoming, messageKind } = input;
  if (!eligible || !incoming || after.deleted || after.muted) return null;
  if (messageKind === 7) return input.reactionToOwnMessage ? 'reaction' : null;
  if (after.unreadCount <= 0) return null;
  if (after.hasReplied) return 'message';
  return !before || (!before.deleted && before.lastMessageId === null) ? 'request' : null;
}

async function deliveryPolicy(tx: Database, target: NotificationTarget): Promise<{ enabled: boolean; requests: boolean }> {
  const rows = await tx.select({ key: devicePreferences.key, value: devicePreferences.value })
    .from(devicePreferences).where(inArray(devicePreferences.key,
      target === 'foreground' ? [UNREAD_INDICATORS_KEY, QUIET_MESSAGE_REQUESTS_KEY]
        : [ENABLED_KEY, QUIET_MESSAGE_REQUESTS_KEY, DND_WINDOW_KEY]));
  const values = new Map(rows.map(row => [row.key, row.value]));
  const requests = values.get(QUIET_MESSAGE_REQUESTS_KEY) !== '1';
  if (target === 'foreground') return { enabled: values.get(UNREAD_INDICATORS_KEY) !== '0', requests };
  const enabled = values.get(ENABLED_KEY);
  if (IS_IOS ? enabled !== '1' : enabled === '0') return { enabled: false, requests };
  const window = parseDndWindow(values.get(DND_WINDOW_KEY) ?? null);
  const now = new Date();
  return { enabled: !window.enabled || !isMinuteInDndWindow(now.getHours() * 60 + now.getMinutes(), window), requests };
}

/** A claimed reaction can be retracted while waiting for presentation. */
export async function getLiveNotificationReactionIds(accountPubkey: string, ids: readonly string[]): Promise<Set<string>> {
  const live = new Set<string>();
  for (let offset = 0; offset < ids.length; offset += 250) {
    const rows = await db.select({ id: messages.id }).from(messages).where(and(
      eq(messages.accountPubkey, accountPubkey),
      eq(messages.kind, 7),
      eq(messages.deleted, false),
      inArray(messages.id, ids.slice(offset, offset + 250)),
    ));
    for (const { id } of rows) live.add(id);
  }
  return live;
}

/** Called inside the successful message transaction, never after commit. */
export async function recordNotificationEvent(tx: Database, input: {
  accountPubkey: string;
  conversationKey: string;
  rumor: Rumor;
  before: NotificationConversationState | null;
  after: NotificationConversationState;
  eligible: boolean;
  incoming: boolean;
  userPresent: boolean;
  systemSupported?: boolean;
  reactionToOwnMessage?: boolean;
}): Promise<boolean> {
  const kind = notificationKindForTransition({ ...input, messageKind: input.rumor.kind });
  if (!kind) return false;
  const target = input.userPresent ? 'foreground' : 'system';
  if (target === 'system' && input.systemSupported === false) return false;
  const policy = await deliveryPolicy(tx, target);
  const request = kind === 'request' || (kind === 'reaction' && !input.after.hasReplied);
  if (!policy.enabled || (request && !policy.requests)) return false;
  await tx.insert(notificationEvents).values({
    accountPubkey: input.accountPubkey, conversationKey: input.conversationKey,
    messageId: input.rumor.id!, kind, target, createdAt: Date.now(),
  }).onConflictDoNothing();
  return true;
}

async function stillEligible(tx: Database, row: ClaimedNotificationEvent): Promise<boolean> {
  const { conversation, message, event } = row;
  if (conversation.deleted || conversation.muted || message.deleted) return false;
  if (event.kind === 'reaction') {
    return conversation.reactionPreviewPending &&
      await reactionTargetsOwnVisibleMessage(tx, conversation, message.rumor);
  }
  if (conversation.unreadCount <= 0) return false;
  if ((event.kind === 'message') !== conversation.hasReplied) return false;
  return conversation.lastReadOrderAt == null || isMessageOrderNewer(
    { orderAt: message.orderAt, id: message.id },
    { orderAt: conversation.lastReadOrderAt, id: conversation.lastReadMessageId ?? '' },
  );
}

/** Writers reserve the shared database before reading. Removing claimed rows
 * makes delivery at-most-once across app/extension runtimes, independent of JS
 * objects or list snapshots. Presentation remains best-effort after the claim. */
export async function takeNotificationEvents(
  accountPubkey: string,
  target: NotificationTarget,
  throughId?: number,
  deliveryKind?: typeof conversations.$inferSelect.deliveryKind,
): Promise<{ events: ClaimedNotificationEvent[]; more: boolean; throughId: number }> {
  return db.transaction(async tx => {
    const oldestEligibleAt = Date.now() - EVENT_TTL_MS;
    // Bound cleanup and delivery independently of accumulated message history.
    const expired = await tx.select({ id: notificationEvents.id }).from(notificationEvents)
      .where(lt(notificationEvents.createdAt, oldestEligibleAt)).limit(BATCH_SIZE);
    if (expired.length > 0) {
      await tx.delete(notificationEvents).where(inArray(notificationEvents.id, expired.map(row => row.id)));
    }
    const [last] = throughId === undefined ? await tx.select({ id: notificationEvents.id }).from(notificationEvents)
      .where(and(eq(notificationEvents.accountPubkey, accountPubkey), eq(notificationEvents.target, target)))
      .orderBy(desc(notificationEvents.id)).limit(1) : [];
    const through = throughId ?? last?.id ?? 0;
    const rows = await tx.select({ event: notificationEvents, conversation: conversations, message: messages })
      .from(notificationEvents)
      .innerJoin(conversations, and(eq(conversations.accountPubkey, notificationEvents.accountPubkey),
        eq(conversations.conversationKey, notificationEvents.conversationKey)))
      .innerJoin(messages, and(eq(messages.accountPubkey, notificationEvents.accountPubkey),
        eq(messages.id, notificationEvents.messageId)))
      .where(and(eq(notificationEvents.accountPubkey, accountPubkey), eq(notificationEvents.target, target),
        lte(notificationEvents.id, through), gte(notificationEvents.createdAt, oldestEligibleAt),
        deliveryKind === undefined ? undefined : eq(conversations.deliveryKind, deliveryKind)))
      .orderBy(asc(notificationEvents.id)).limit(BATCH_SIZE);
    if (rows.length === 0) return { events: [], more: false, throughId: through };
    await tx.delete(notificationEvents).where(inArray(notificationEvents.id, rows.map(row => row.event.id)));
    // Settings can change between receipt and delivery. Disallowed events are
    // consumed rather than queued for catch-up when the setting changes again.
    const policy = await deliveryPolicy(tx, target);
    const events: ClaimedNotificationEvent[] = [];
    if (policy.enabled) {
      for (const row of rows) {
        if ((policy.requests || row.conversation.hasReplied) && await stillEligible(tx, row)) events.push(row);
      }
    }
    return {
      events,
      more: rows.length === BATCH_SIZE && rows[rows.length - 1].event.id < through,
      throughId: through,
    };
  });
}

export async function discardNotificationEvents(
  accountPubkey: string, target: NotificationTarget, through = Date.now(),
): Promise<void> {
  await db.transaction(async tx => {
    const condition = and(eq(notificationEvents.accountPubkey, accountPubkey),
      eq(notificationEvents.target, target), lt(notificationEvents.createdAt, through + 1));
    const [pending] = await tx.select({ id: notificationEvents.id }).from(notificationEvents).where(condition).limit(1);
    // Avoid no-op writes: desktop invalidates subscribers even for empty deletes.
    if (pending) await tx.delete(notificationEvents).where(condition);
  });
}
