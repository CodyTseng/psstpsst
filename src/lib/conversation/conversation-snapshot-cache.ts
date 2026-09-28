import type { conversations } from '@/db/schema';

export type ConversationSnapshot = typeof conversations.$inferSelect;

const snapshotCache = new Map<string, ConversationSnapshot>();

function snapshotKey(accountPubkey: string, conversationKey: string): string {
  return `${accountPubkey}:${conversationKey}`;
}

/** Remember one already-resolved conversation row for transition-time chrome. */
export function rememberConversationSnapshot(snapshot: ConversationSnapshot): void {
  if (!snapshot.accountPubkey || !snapshot.conversationKey) return;
  snapshotCache.set(
    snapshotKey(snapshot.accountPubkey, snapshot.conversationKey),
    snapshot,
  );
}

/** Memory-only lookup. Never falls back to SQLite during a navigation render. */
export function getSessionCachedConversation(
  accountPubkey: string,
  conversationKey: string,
): ConversationSnapshot | null {
  if (!accountPubkey || !conversationKey) return null;
  return snapshotCache.get(snapshotKey(accountPubkey, conversationKey)) ?? null;
}
