import { useMemo } from 'react';

import {
  type ConversationWithLast,
  useMainInboxConversations,
  useRequestConversations,
} from '@/hooks/use-conversations';
import { useContacts } from '@/hooks/use-contacts';
import { useProfilesMap } from '@/hooks/use-profile';
import { resolveName } from '@/lib/nostr/display-name';

/**
 * In-memory name search over the account's conversations (inbox + requests, all
 * non-deleted). Matches a DM by the counterparty's resolved name (petname >
 * profile display_name > name) and a group by its subject. Conversation counts
 * are bounded (tens–hundreds), so this is a cheap `useMemo` filter — no SQL.
 * Returns `ConversationWithLast[]` so the caller renders the same
 * `ConversationListItem` as the inbox. Empty query → no results.
 */
export function useConversationSearch(
  accountPubkey: string,
  query: string,
): ConversationWithLast[] {
  const { conversations: inbox } = useMainInboxConversations(accountPubkey);
  const { conversations: requests } = useRequestConversations(accountPubkey);

  const all = useMemo(() => [...inbox, ...requests], [inbox, requests]);

  // conversationKey → the (single, for a DM) counterparty pubkey.
  const counterpartyByKey = useMemo(() => {
    const m = new Map<string, string | null>();
    // conversation_key IS the counterparty pubkey.
    for (const item of all) {
      m.set(item.conversation.conversationKey, item.conversation.conversationKey);
    }
    return m;
  }, [all]);

  const counterpartyPubkeys = useMemo(
    () => Array.from(new Set([...counterpartyByKey.values()].filter((p): p is string => !!p))),
    [counterpartyByKey],
  );
  const profiles = useProfilesMap(counterpartyPubkeys);

  const { contacts } = useContacts(accountPubkey);
  const petnameByPubkey = useMemo(() => {
    const m: Record<string, string> = {};
    for (const ct of contacts) if (ct.petname) m[ct.pubkey] = ct.petname;
    return m;
  }, [contacts]);

  const q = query.trim().toLowerCase();

  return useMemo(() => {
    if (!q) return [];
    return all
      .filter((item) => {
        const conv = item.conversation;
        const cp = counterpartyByKey.get(conv.conversationKey);
        if (!cp) return false;
        const name = resolveName({
          petname: petnameByPubkey[cp],
          displayName: profiles[cp]?.displayName,
          name: profiles[cp]?.name,
        });
        return !!name && name.toLowerCase().includes(q);
      })
      .sort((a, b) => b.conversation.lastMessageOrderAt - a.conversation.lastMessageOrderAt);
  }, [q, all, counterpartyByKey, profiles, petnameByPubkey]);
}
