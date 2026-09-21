import type { messages } from '@/db/schema';
import { platform } from '@/platform';

import {
  getWarmedMessageTail,
  getWarmedMessageTailPresentation,
  mergeStoredMessageIntoTail,
  replaceWarmedMessageTail,
  warmMessageTail,
} from '../message-tail-cache';

const mockRawQuery = jest.spyOn(platform.database, 'rawQuery');

type MessageRow = typeof messages.$inferSelect;

type RawMessage = {
  account_pubkey: string;
  id: string;
  conversation_key: string;
  sender_pubkey: string;
  kind: number;
  content: string;
  created_at: number;
  order_at: number;
  reply_to_id: string | null;
  subject: string | null;
  tags: string;
  rumor: string;
  delivery_status: MessageRow['deliveryStatus'];
  source_relays: string | null;
};

function rawMessage(
  id: string,
  conversationKey: string,
  overrides: Partial<RawMessage> = {},
): RawMessage {
  return { ...rawMessageBase(id, conversationKey), ...overrides };
}

function rawMessageBase(id: string, conversationKey: string): RawMessage {
  return {
    account_pubkey: 'account',
    id,
    conversation_key: conversationKey,
    sender_pubkey: 'sender',
    kind: 14,
    content: id,
    created_at: 1,
    order_at: 1,
    reply_to_id: null,
    subject: null,
    tags: '[]',
    rumor: '{}',
    delivery_status: null,
    source_relays: null,
  };
}

function messageRow(
  id: string,
  conversationKey: string,
  overrides: Partial<MessageRow> = {},
): MessageRow {
  return {
    accountPubkey: 'account',
    id,
    conversationKey,
    senderPubkey: 'sender',
    kind: 14,
    content: id,
    createdAt: 1,
    orderAt: 1,
    replyToId: null,
    subject: null,
    tags: [],
    rumor: {} as MessageRow['rumor'],
    deliveryStatus: null,
    sourceRelays: null,
    ...overrides,
  };
}

describe('message tail cache', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    mockRawQuery.mockReset();
  });

  afterEach(async () => {
    await jest.runAllTimersAsync();
    jest.useRealTimers();
  });

  it('merges a just-stored message into the cached window without a database read', async () => {
    const conversationKey = 'merge-head';
    mockRawQuery.mockResolvedValueOnce([rawMessage('older', conversationKey, { order_at: 1 })]);
    await warmMessageTail('account', conversationKey);
    expect(mockRawQuery).toHaveBeenCalledTimes(1);

    mergeStoredMessageIntoTail(
      'account',
      messageRow('newer', conversationKey, { orderAt: 2 }),
    );

    expect(mockRawQuery).toHaveBeenCalledTimes(1);
    expect(getWarmedMessageTail('account', conversationKey)?.map((row) => row.id)).toEqual([
      'newer',
      'older',
    ]);
  });

  it('inserts by (orderAt, id) order inside the window', async () => {
    const conversationKey = 'merge-mid';
    mockRawQuery.mockResolvedValueOnce([
      rawMessage('c', conversationKey, { order_at: 3 }),
      rawMessage('a', conversationKey, { order_at: 1 }),
    ]);
    await warmMessageTail('account', conversationKey);

    mergeStoredMessageIntoTail('account', messageRow('b', conversationKey, { orderAt: 2 }));

    expect(getWarmedMessageTail('account', conversationKey)?.map((row) => row.id)).toEqual([
      'c',
      'b',
      'a',
    ]);
  });

  it('puts the smaller id first in a newest-first timestamp tie', async () => {
    const conversationKey = 'merge-tie';
    mockRawQuery.mockResolvedValueOnce([
      rawMessage('id-m', conversationKey),
      rawMessage('id-z', conversationKey),
    ]);
    await warmMessageTail('account', conversationKey);

    mergeStoredMessageIntoTail('account', messageRow('id-a', conversationKey));

    expect(getWarmedMessageTail('account', conversationKey)?.map((row) => row.id)).toEqual([
      'id-a',
      'id-m',
      'id-z',
    ]);
  });

  it('skips rows older than a full window and trims inserts to the page size', async () => {
    const conversationKey = 'merge-window';
    mockRawQuery.mockResolvedValueOnce(
      Array.from({ length: 15 }, (_, index) =>
        rawMessage(`m${index}`, conversationKey, { order_at: 100 - index }),
      ),
    );
    await warmMessageTail('account', conversationKey);

    // Older than the oldest cached row: no change.
    mergeStoredMessageIntoTail(
      'account',
      messageRow('ancient', conversationKey, { orderAt: 1 }),
    );
    let ids = getWarmedMessageTail('account', conversationKey)?.map((row) => row.id);
    expect(ids).toHaveLength(15);
    expect(ids).not.toContain('ancient');

    // Newer than the head: inserted at the front, oldest dropped.
    mergeStoredMessageIntoTail(
      'account',
      messageRow('fresh', conversationKey, { orderAt: 200 }),
    );
    ids = getWarmedMessageTail('account', conversationKey)?.map((row) => row.id);
    expect(ids?.[0]).toBe('fresh');
    expect(ids).toHaveLength(15);
    expect(ids).not.toContain('m14');
  });

  it('keeps only one tail page when a paginated live result refreshes the cache', () => {
    const conversationKey = 'replace-window';
    const rows = Array.from({ length: 30 }, (_, index) =>
      messageRow(`m${index}`, conversationKey, { orderAt: 100 - index }),
    );

    replaceWarmedMessageTail('account', conversationKey, rows);

    expect(getWarmedMessageTail('account', conversationKey)?.map((row) => row.id)).toEqual(
      rows.slice(0, 15).map((row) => row.id),
    );
    expect(
      getWarmedMessageTailPresentation('account', conversationKey)?.rowsNewestFirst,
    ).toHaveLength(15);
  });

  it('ignores a message already in the window', async () => {
    const conversationKey = 'merge-dedupe';
    mockRawQuery.mockResolvedValueOnce([rawMessage('same', conversationKey)]);
    await warmMessageTail('account', conversationKey);

    const before = getWarmedMessageTail('account', conversationKey);
    mergeStoredMessageIntoTail('account', messageRow('same', conversationKey));

    expect(getWarmedMessageTail('account', conversationKey)).toBe(before);
  });

  it('ignores kinds outside the warm window contract', async () => {
    const conversationKey = 'merge-kind';
    mockRawQuery.mockResolvedValueOnce([rawMessage('chat', conversationKey)]);
    await warmMessageTail('account', conversationKey);

    mergeStoredMessageIntoTail(
      'account',
      messageRow('meta', conversationKey, { kind: 44, orderAt: 2 }),
    );

    expect(getWarmedMessageTail('account', conversationKey)?.map((row) => row.id)).toEqual([
      'chat',
    ]);
  });

  it('does nothing for a conversation without a cached tail', () => {
    mergeStoredMessageIntoTail('account', messageRow('x', 'merge-cold'));

    expect(getWarmedMessageTail('account', 'merge-cold')).toBeNull();
    expect(mockRawQuery).not.toHaveBeenCalled();
  });

  it('discards an in-flight read that started before the merged write', async () => {
    const conversationKey = 'merge-in-flight';
    let resolveOld!: (rows: RawMessage[]) => void;
    mockRawQuery.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveOld = resolve;
      }),
    );

    const pendingWarm = warmMessageTail('account', conversationKey);
    mergeStoredMessageIntoTail(
      'account',
      messageRow('merged', conversationKey, { orderAt: 2 }),
    );

    // No cached entry to merge into — and the stale read must not paint one.
    mockRawQuery.mockResolvedValueOnce([
      rawMessage('merged', conversationKey, { order_at: 2 }),
      rawMessage('old', conversationKey),
    ]);
    resolveOld([rawMessage('old', conversationKey)]);
    await pendingWarm;
    expect(getWarmedMessageTail('account', conversationKey)).toBeNull();

    await jest.runAllTimersAsync();
    expect(getWarmedMessageTail('account', conversationKey)?.map((row) => row.id)).toEqual([
      'merged',
      'old',
    ]);
  });

  it('folds a merged reaction into the aggregates', async () => {
    const conversationKey = 'merge-reaction';
    mockRawQuery.mockResolvedValueOnce([rawMessage('target', conversationKey, { order_at: 1 })]);
    await warmMessageTail('account', conversationKey);

    mergeStoredMessageIntoTail(
      'account',
      messageRow('reaction', conversationKey, {
        senderPubkey: 'account',
        kind: 7,
        content: '+',
        orderAt: 2,
        replyToId: 'target',
      }),
    );

    const prepared = getWarmedMessageTailPresentation('account', conversationKey);
    expect(prepared?.messagesAscending.map((row) => row.id)).toEqual(['target']);
    expect(prepared?.reactionsByMessageId.target).toEqual([
      expect.objectContaining({ emoji: '👍', count: 1, selfReacted: true }),
    ]);
  });

  it('prepares the stable bubble window and reaction aggregates before navigation', async () => {
    const conversationKey = 'presentation';
    mockRawQuery.mockResolvedValueOnce([
      rawMessage('reaction', conversationKey, {
        sender_pubkey: 'account',
        kind: 7,
        content: '+',
        order_at: 3,
        reply_to_id: 'newer',
      }),
      rawMessage('newer', conversationKey, {
        order_at: 2,
        reply_to_id: 'older',
      }),
      rawMessage('older', conversationKey, { order_at: 1 }),
    ]);

    await warmMessageTail('account', conversationKey);

    const prepared = getWarmedMessageTailPresentation(
      'account',
      conversationKey,
    );
    expect(prepared?.rowsAscending.map((row) => row.id)).toEqual([
      'older',
      'newer',
      'reaction',
    ]);
    expect(prepared?.messagesAscending.map((row) => row.id)).toEqual([
      'older',
      'newer',
    ]);
    expect(prepared?.reactionsByMessageId.newer).toEqual([
      expect.objectContaining({ emoji: '👍', count: 1, selfReacted: true }),
    ]);
    expect(prepared?.bubbleRenderItemsById.newer).toMatchObject({
      olderMessageId: 'older',
      groupStart: false,
      showDate: false,
      replyTarget: expect.objectContaining({ id: 'older' }),
      presentation: prepared?.presentationsByMessageId.newer,
      reactions: prepared?.reactionsByMessageId.newer,
    });
    expect(
      getWarmedMessageTailPresentation('account', conversationKey),
    ).toBe(prepared);
  });
});
