import { KIND_USER_EMOJI_LIST } from '@/lib/nostr/custom-emoji';

import { buildSigner } from '../account/account.service';
import { applyContactsEvent, CONTACTS_D } from '../contact/contact.service';
import { applyMutedEvent, MUTED_D } from '../conversation/conversation-prefs.service';
import { applyBlockedEvent, BLOCKED_D } from '../dm/block.service';
import { applyUserEmojiListEvent } from '../emoji/custom-emoji.service';
import {
  applyMediaServersEvent,
  KIND_BLOSSOM_SERVER_LIST,
} from '../files/media-server.service';
import type { Signer } from '../signer/signer.interface';
import { loadAccountWriteRelays } from './relay-list.service';
import {
  ensureReplaceableFresh,
  getReplaceableEvents,
  REPLACEABLE_DEFAULT_TTL_SECONDS,
  type ReplaceableKey,
} from './replaceable-events.service';

/** NIP-51 follow set — the kind carrying the private muted/contacts/blocked sets. */
const KIND_FOLLOW_SET = 30000;

/**
 * One-shot sync of the account's personal configuration lists: preferred emojis
 * (kind 10030), Blossom media servers (kind 10063), and the private NIP-51
 * muted/contacts/blocked sets (kind 30000). All keys
 * share one relay set, so a stale batch goes out as a single multi-filter REQ
 * and a fully fresh cache costs zero network. After the freshness pass the
 * stored events are dispatched to each domain reconciler. Best-effort: safe to
 * call on app start / tab focus, fire-and-forget.
 */
export async function syncPersonalConfigs(accountPubkey: string): Promise<void> {
  const keys: ReplaceableKey[] = [
    { pubkey: accountPubkey, kind: KIND_USER_EMOJI_LIST },
    { pubkey: accountPubkey, kind: KIND_BLOSSOM_SERVER_LIST },
    { pubkey: accountPubkey, kind: KIND_FOLLOW_SET, dTag: MUTED_D },
    { pubkey: accountPubkey, kind: KIND_FOLLOW_SET, dTag: CONTACTS_D },
    { pubkey: accountPubkey, kind: KIND_FOLLOW_SET, dTag: BLOCKED_D },
  ];
  const relays = await loadAccountWriteRelays(accountPubkey);
  await ensureReplaceableFresh(keys, {
    ttlSeconds: REPLACEABLE_DEFAULT_TTL_SECONDS,
    relays,
  });

  const [userEmojiList, mediaServers, muted, contacts, blocked] =
    await getReplaceableEvents(keys);

  // The private sets need the account's decryption key; without it (unknown
  // account, or a remote signer mid-teardown) skip them but still apply the
  // public lists.
  const signer: Signer | null = await buildSigner(accountPubkey).catch(() => null);
  await Promise.all([
    applyMediaServersEvent(accountPubkey, mediaServers),
    applyUserEmojiListEvent(accountPubkey, userEmojiList),
    ...(signer
      ? [
          applyMutedEvent(accountPubkey, muted, signer),
          applyContactsEvent(accountPubkey, contacts, signer),
          applyBlockedEvent(accountPubkey, blocked, signer),
        ]
      : []),
  ]);
}
