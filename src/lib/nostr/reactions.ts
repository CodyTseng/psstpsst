import type { messages as messagesSchema } from '@/db/schema';
import {
  customEmojisFromMessageTags,
  type CustomEmoji,
} from '@/lib/nostr/custom-emoji';

type MessageRow = typeof messagesSchema.$inferSelect;

/**
 * Matches a string that contains at least one emoji/pictographic character.
 * Hermes lacks `\p{Extended_Pictographic}`, so the emoji code ranges are
 * enumerated explicitly: BMP symbol/dingbat blocks plus the astral emoji
 * planes (reached via surrogate pairs). Variation selectors / ZWJ are omitted:
 * a real emoji always also carries a base pictographic char that matches here.
 */
const EMOJI_CHAR =
  /[©®‼⁉™ℹ↔-↙↩-↪⌚-⌛⌨⏏⏩-⏳⏸-⏺Ⓜ▪-▫▶◀◻-◾☀-➿⤴-⤵⬅-⬇⬛-⬜⭐⭕〰〽㊗㊙]|[\uD83C-\uD83E][\uDC00-\uDFFF]/;

/**
 * Normalize a kind-7 reaction to what we display. A NIP-30 shortcode is trusted
 * only when the same row carries its matching valid `emoji` tag. Per NIP-25 a
 * `-` means "dislike" (👎), while `+` (and an empty string) means "like" (👍).
 * Any other non-emoji content collapses onto the same 👍 chip instead of being
 * shown as raw text.
 */
function normalizeReaction(
  content: string | null,
  tags: string[][] | null | undefined,
): { emoji: string; customEmoji: CustomEmoji | null } {
  const raw = (content ?? '').trim();
  const customEmoji = customEmojisFromMessageTags(tags).find(
    (candidate) => raw === `:${candidate.shortcode}:`,
  );
  if (customEmoji) {
    return { emoji: `:${customEmoji.shortcode}:`, customEmoji };
  }
  if (raw === '-') return { emoji: '👎', customEmoji: null };
  return {
    emoji: EMOJI_CHAR.test(raw) ? raw : '👍',
    customEmoji: null,
  };
}

export type ReactionAggregate = {
  emoji: string;
  /** NIP-30 image metadata when this is a custom emoji reaction. */
  customEmoji: CustomEmoji | null;
  count: number;
  /** True if the active account has reacted with this emoji. */
  selfReacted: boolean;
  /** Reaction message id authored by the active account (if any), for removal. */
  selfReactionId: string | null;
};

/**
 * A reaction is just a message (kind 7) — it rides in the same paginated window
 * as everything else and is only *rendered* differently (a chip on its target
 * bubble, not a bubble of its own). This pure helper groups the kind-7 rows of
 * the loaded window by their target message id, then aggregates by emoji.
 *
 * No separate query is needed: the window is a contiguous newest-first slice and
 * a reaction is always newer than its target, so any on-screen message has its
 * reactions in the same window.
 */
export function aggregateReactionsByTarget(
  rows: MessageRow[],
  accountPubkey: string,
  proximity = false,
): Record<string, ReactionAggregate[]> {
  const byTarget: Record<
    string,
    Map<
      string,
      {
        emoji: string;
        customEmoji: CustomEmoji | null;
        count: number;
        selfReacted: boolean;
        selfReactionId: string | null;
      }
    >
  > = {};

  for (const r of rows) {
    if (r.kind !== 7 || !r.replyToId) continue;
    const { emoji, customEmoji } = normalizeReaction(r.content, r.tags);
    const reactionKey = customEmoji
      ? `custom\u0000${customEmoji.shortcode.toLowerCase()}\u0000${customEmoji.url}`
      : `unicode\u0000${emoji}`;
    const bucket = byTarget[r.replyToId] ?? (byTarget[r.replyToId] = new Map());
    const entry = bucket.get(reactionKey) ?? {
      emoji,
      customEmoji,
      count: 0,
      selfReacted: false,
      selfReactionId: null,
    };
    entry.count += 1;
    if (
      proximity
        ? r.senderPubkey !== r.conversationKey
        : r.senderPubkey === accountPubkey
    ) {
      entry.selfReacted = true;
      entry.selfReactionId = r.id;
    }
    bucket.set(reactionKey, entry);
  }

  const out: Record<string, ReactionAggregate[]> = {};
  for (const [targetId, bucket] of Object.entries(byTarget)) {
    out[targetId] = Array.from(bucket.values()).map((v) => ({
      emoji: v.emoji,
      customEmoji: v.customEmoji,
      count: v.count,
      selfReacted: v.selfReacted,
      selfReactionId: v.selfReactionId,
    }));
  }
  return out;
}
