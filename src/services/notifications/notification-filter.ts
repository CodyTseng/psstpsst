import { and, eq, inArray } from 'drizzle-orm';

import { db } from '@/db/client';
import { conversations } from '@/db/schema';
import type { Rumor } from '@/db/schema/types';
import { deriveConversationKey } from '@/lib/nostr/conversation-key';
import { getPTags } from '@/lib/nostr/tags';

const KIND_REACTION = 7;
const CONVERSATION_QUERY_CHUNK_SIZE = 500;

/**
 * Filter one batch of freshly-stored rumors before notification delivery. Cheap
 * message-only rules run first, then conversation state is fetched in bounded
 * `IN` queries instead of one SQLite query per rumor. Blocked senders are
 * dropped before storage, so they never reach this layer.
 */
export async function filterNotifiableMessages(
  rumors: Rumor[],
  accountPubkey: string,
): Promise<Rumor[]> {
  const candidates = new Map<string, { rumor: Rumor; conversationKey: string }>();
  for (const rumor of rumors) {
    if (candidates.has(rumor.id)) continue;
    if (rumor.pubkey === accountPubkey || rumor.kind === KIND_REACTION) continue;

    const conversationKey = deriveConversationKey(
      rumor.pubkey,
      getPTags(rumor.tags),
      accountPubkey,
    );
    // Group / CC messages have no 1:1 conversation and never notify.
    if (conversationKey !== null) candidates.set(rumor.id, { rumor, conversationKey });
  }
  if (candidates.size === 0) return [];

  const conversationKeys = Array.from(
    new Set(Array.from(candidates.values(), (candidate) => candidate.conversationKey)),
  );
  const allowed = new Set<string>();
  for (let offset = 0; offset < conversationKeys.length; offset += CONVERSATION_QUERY_CHUNK_SIZE) {
    const chunk = conversationKeys.slice(offset, offset + CONVERSATION_QUERY_CHUNK_SIZE);
    const rows = await db
      .select({
        conversationKey: conversations.conversationKey,
        muted: conversations.muted,
        hasReplied: conversations.hasReplied,
      })
      .from(conversations)
      .where(
        and(
          eq(conversations.accountPubkey, accountPubkey),
          inArray(conversations.conversationKey, chunk),
        ),
      );
    for (const row of rows) {
      if (row.hasReplied && !row.muted) allowed.add(row.conversationKey);
    }
  }

  return Array.from(candidates.values())
    .filter((candidate) => allowed.has(candidate.conversationKey))
    .map((candidate) => candidate.rumor);
}
