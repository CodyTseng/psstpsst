import dayjs from 'dayjs';
import { useMemo } from 'react';
import { View } from 'react-native';

import { MessageBubble } from '@/components/chat/MessageBubble';
import type { ReactionAggregate } from '@/lib/nostr/reactions';
import { findFileMeta } from '@/lib/nostr/file-tags';
import type { ForwardMessage } from '@/lib/share/forward';
import { KIND_FILE } from '@/services/crypto/nip17-gift-wrap';

// Stable empties so the memoized bubble never re-renders on a fresh closure.
const NO_REACTIONS: ReactionAggregate[] = [];
const noop = () => {};

/**
 * Forward preview: the queued messages rendered with the real {@link MessageBubble}
 * — the same bubbles as a live thread — as right-side **self** bubbles (we're the
 * one forwarding) stamped with the current time (when the forward will send).
 * Static: no gestures, reactions, or delivery ticks.
 *
 * Deliberately **not its own scroll view** — it uses the shared sheet background,
 * including the bubble rows, so it blends into the sheet rather than reading as
 * an embedded chat. The enclosing sheet owns overflow, fades, and dismissal.
 */
export function ForwardPreview({ messages }: { messages: ForwardMessage[] }) {
  // One "now" for every previewed bubble — that's when the forward sends.
  const now = useMemo(() => dayjs().unix(), []);

  return (
    // pointerEvents none: a preview is look-only — taps on a previewed bubble's
    // links / mentions / image / reply must do nothing. The enclosing ScrollView
    // still scrolls and the sheet still drag-dismisses (their gestures sit on the
    // ScrollView, not this content).
    <View style={{ pointerEvents: 'none' }}>
      {messages.map((m, i) => (
        <MessageBubble
          // Index key: the preview list is static and never reorders.
          key={i}
          content={m.content}
          tags={m.tags}
          isSelf
          createdAt={now}
          orderAt={now * 1000 + i}
          reactions={NO_REACTIONS}
          attachment={m.kind === KIND_FILE ? findFileMeta(m.content, m.tags) : null}
          groupStart={i === 0}
          // The sheet already owns the canvas. Keeping the row transparent
          // avoids painting a full-width strip behind the bubble.
          rowBackground="transparent"
          onTapReaction={noop}
        />
      ))}
    </View>
  );
}
