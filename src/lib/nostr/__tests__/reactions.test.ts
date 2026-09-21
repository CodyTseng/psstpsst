import type { messages as messagesSchema } from '@/db/schema';

import { aggregateReactionsByTarget } from '../reactions';

type MessageRow = typeof messagesSchema.$inferSelect;

function reactionRow({
  id,
  senderPubkey = 'peer',
  content,
  tags = [],
}: {
  id: string;
  senderPubkey?: string;
  content: string;
  tags?: string[][];
}): MessageRow {
  return {
    accountPubkey: 'self',
    id,
    conversationKey: 'peer',
    senderPubkey,
    kind: 7,
    content,
    createdAt: 1,
    orderAt: 1,
    replyToId: 'target',
    subject: null,
    tags,
    rumor: {} as MessageRow['rumor'],
    deliveryStatus: null,
    sourceRelays: null,
  };
}

describe('aggregateReactionsByTarget', () => {
  test('renders and aggregates a tagged custom emoji reaction', () => {
    const emojiTag = ['emoji', 'party_blob', 'https://example.com/party.png'];
    const result = aggregateReactionsByTarget(
      [
        reactionRow({
          id: 'peer-reaction',
          content: ':party_blob:',
          tags: [emojiTag],
        }),
        reactionRow({
          id: 'self-reaction',
          senderPubkey: 'self',
          content: ':party_blob:',
          tags: [emojiTag],
        }),
      ],
      'self',
    );

    expect(result.target).toEqual([
      {
        emoji: ':party_blob:',
        customEmoji: {
          shortcode: 'party_blob',
          url: 'https://example.com/party.png',
          setAddress: undefined,
        },
        count: 2,
        selfReacted: true,
        selfReactionId: 'self-reaction',
      },
    ]);
  });

  test('keeps the same shortcode with different image URLs distinct', () => {
    const result = aggregateReactionsByTarget(
      [
        reactionRow({
          id: 'first',
          content: ':blob:',
          tags: [['emoji', 'blob', 'https://example.com/one.png']],
        }),
        reactionRow({
          id: 'second',
          content: ':blob:',
          tags: [['emoji', 'blob', 'https://example.com/two.png']],
        }),
      ],
      'self',
    );

    expect(result.target).toHaveLength(2);
    expect(result.target.map((reaction) => reaction.customEmoji?.url)).toEqual([
      'https://example.com/one.png',
      'https://example.com/two.png',
    ]);
  });

  test('does not render an untagged or mismatched shortcode as custom emoji', () => {
    const result = aggregateReactionsByTarget(
      [
        reactionRow({ id: 'untagged', content: ':blob:' }),
        reactionRow({
          id: 'mismatched',
          content: ':blob:',
          tags: [['emoji', 'other', 'https://example.com/other.png']],
        }),
      ],
      'self',
    );

    expect(result.target).toEqual([
      {
        emoji: '👍',
        customEmoji: null,
        count: 2,
        selfReacted: false,
        selfReactionId: null,
      },
    ]);
  });

  test('uses the archived Nearby owner when classifying a self reaction', () => {
    const result = aggregateReactionsByTarget(
      [
        reactionRow({
          id: 'archived-self-reaction',
          senderPubkey: 'old-nearby-owner',
          content: '👍',
        }),
      ],
      'current-nearby-owner',
      true,
    );

    expect(result.target[0]).toMatchObject({
      selfReacted: true,
      selfReactionId: 'archived-self-reaction',
    });
  });
});
