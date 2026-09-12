/**
 * conversation_key is a bare pubkey: the other party's, or our own for a
 * note-to-self. There is no prefix and no participants list — group chat is
 * unsupported, so a rumor with more than one counterparty (a CC / group h-tag
 * fan-out) has no conversation at all.
 *
 * Returns null when the rumor has no 1:1 home — either it isn't addressed to us,
 * or it has multiple counterparties. Callers drop a null-keyed rumor: it is
 * never stored and never notifies.
 */
export function deriveConversationKey(
  senderPubkey: string,
  pTags: string[],
  accountPubkey: string,
): string | null {
  const participants = new Set([senderPubkey, ...pTags]);
  // A gift wrap we decrypted is addressed to us; guard against a malformed rumor
  // that somehow isn't, rather than filing it under a stranger.
  if (!participants.has(accountPubkey)) return null;
  participants.delete(accountPubkey);
  // More than one remaining counterparty → group / CC, unsupported.
  if (participants.size > 1) return null;
  // No one left → note-to-self (we are our own counterparty); else the sole peer.
  const [peer] = participants;
  return peer ?? accountPubkey;
}
