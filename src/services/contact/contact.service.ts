import { and, eq, inArray, notInArray, sql } from 'drizzle-orm';
import type { Event } from 'nostr-tools';

import { db, type Database } from '@/db/client';
import { contacts, contactSyncState, conversations } from '@/db/schema';
import { normalizeRelayUrl } from '@/lib/nostr/relay-url';

import { buildSigner } from '../account/account.service';
import { ownMetaRelays } from '../relay/relay-list.service';
import { enqueueConfigurationEvent, getPendingConfiguration } from '../relay/configuration-publish.service';
import {
  ensureReplaceableFresh,
  getReplaceableEvent,
  REPLACEABLE_DEFAULT_TTL_SECONDS,
} from '../relay/replaceable-events.service';
import type { Signer } from '../signer/signer.interface';

/** NIP-51 follow set (kind 30000) reserved for PsstPsst's private contact list.
 * A private self-only list lives on our own outbox (`ownMetaRelays` = write ∪
 * discovery) — never a peer's relays. */
const KIND_FOLLOW_SET = 30000;
const KIND_NOSTR_CONTACT_LIST = 3;
/** d-tag of the private contact set. */
export const CONTACTS_D = 'psstpsst-contacts';
const CONTACTS_TITLE = 'PsstPsst Contacts';

async function readSyncState(accountPubkey: string, tx: Database = db) {
  const [state] = await tx
    .select()
    .from(contactSyncState)
    .where(eq(contactSyncState.accountPubkey, accountPubkey)).limit(1);
  return state;
}

/** Commit the pending revision in the same transaction as the contact edit. */
async function markContactsDirty(accountPubkey: string, tx: Database): Promise<void> {
  await tx
    .insert(contactSyncState)
    .values({ accountPubkey, revision: 1, dirty: true })
    .onConflictDoUpdate({
      target: contactSyncState.accountPubkey,
      set: { revision: sql`${contactSyncState.revision} + 1`, dirty: true },
    });
}


export type NostrFollowContactCandidate = {
  pubkey: string;
  relayHint: string | null;
  petname: string | null;
  alreadyContact: boolean;
};

function isHexPubkey(value: string): boolean {
  return /^[0-9a-f]{64}$/i.test(value);
}

function normalizeOptionalRelay(value: string | undefined): string | null {
  if (!value) return null;
  try {
    return normalizeRelayUrl(value);
  } catch {
    return null;
  }
}

/** Read the account's saved contacts with their petnames (local source of truth). */
export async function getContactEntries(
  accountPubkey: string,
): Promise<{ pubkey: string; petname: string | null }[]> {
  return db
    .select({ pubkey: contacts.pubkey, petname: contacts.petname })
    .from(contacts)
    .where(eq(contacts.accountPubkey, accountPubkey));
}

export async function isContact(accountPubkey: string, pubkey: string): Promise<boolean> {
  const rows = await db
    .select({ pubkey: contacts.pubkey })
    .from(contacts)
    .where(and(eq(contacts.accountPubkey, accountPubkey), eq(contacts.pubkey, pubkey)))
    .limit(1);
  return rows.length > 0;
}

/** Fetch the account's latest public NIP-02 contact list (kind 3) and return
 * valid, deduped p-tag members as import candidates. This is only a seed source
 * for PsstPsst's private contact list; importing remains an explicit user choice.
 * Goes through the shared replaceable-events cache (24h TTL), so repeat visits
 * within the window cost zero network. */
export async function fetchNostrFollowContactCandidates(
  accountPubkey: string,
): Promise<NostrFollowContactCandidate[]> {
  const key = { pubkey: accountPubkey, kind: KIND_NOSTR_CONTACT_LIST };
  const targets = await ownMetaRelays(accountPubkey);
  await ensureReplaceableFresh([key], {
    ttlSeconds: REPLACEABLE_DEFAULT_TTL_SECONDS,
    relays: targets,
  });
  const latest = await getReplaceableEvent(key);
  if (!latest) return [];
  const seen = new Set<string>();
  const candidates: Omit<NostrFollowContactCandidate, 'alreadyContact'>[] = [];
  for (const tag of latest.tags) {
    if (tag[0] !== 'p' || !tag[1]) continue;
    const pubkey = tag[1].toLowerCase();
    if (!isHexPubkey(pubkey) || pubkey === accountPubkey || seen.has(pubkey)) continue;
    seen.add(pubkey);
    candidates.push({
      pubkey,
      relayHint: normalizeOptionalRelay(tag[2]),
      petname: tag[3]?.trim() || null,
    });
  }
  if (candidates.length === 0) return [];

  const existingRows = await db
    .select({ pubkey: contacts.pubkey })
    .from(contacts)
    .where(
      and(
        eq(contacts.accountPubkey, accountPubkey),
        inArray(
          contacts.pubkey,
          candidates.map((c) => c.pubkey),
        ),
      ),
    );
  const existing = new Set(existingRows.map((r) => r.pubkey));
  return candidates.map((candidate) => ({
    ...candidate,
    alreadyContact: existing.has(candidate.pubkey),
  }));
}

/** Import a user-selected subset of public kind-3 follows into the private
 * PsstPsst contacts table. Additive only: existing contacts and petnames are left
 * untouched, and the private synced set is re-published best-effort afterwards. */
export async function importNostrFollowContacts(
  accountPubkey: string,
  pubkeys: string[],
): Promise<{ imported: number }> {
  const seen = new Set<string>();
  const requested = pubkeys
    .map((p) => p.toLowerCase())
    .filter((p) => {
      if (!isHexPubkey(p) || p === accountPubkey || seen.has(p)) return false;
      seen.add(p);
      return true;
    });
  if (requested.length === 0) return { imported: 0 };

  const existingRows = await db
    .select({ pubkey: contacts.pubkey })
    .from(contacts)
    .where(and(eq(contacts.accountPubkey, accountPubkey), inArray(contacts.pubkey, requested)));
  const existing = new Set(existingRows.map((r) => r.pubkey));
  const toImport = requested.filter((pubkey) => !existing.has(pubkey));
  if (toImport.length === 0) return { imported: 0 };

  const now = Math.floor(Date.now() / 1000);
  await db.transaction(async (tx) => {
    await markContactsDirty(accountPubkey, tx);
    await tx
      .insert(contacts)
      .values(
        toImport.map((pubkey) => ({
          accountPubkey,
          pubkey,
          addedAt: now,
          source: 'manual' as const,
        })),
      )
      .onConflictDoNothing()
      .run();

    await tx
      .update(conversations)
      .set({ hasReplied: true })
      .where(
        and(
          eq(conversations.accountPubkey, accountPubkey),
          inArray(conversations.conversationKey, toImport),
          eq(conversations.hasReplied, false),
        ),
      )
      .run();
  });

  publishContactSetInBackground(accountPubkey);
  return { imported: toImport.length };
}

/**
 * Re-publish the entire contact list as a private NIP-51 follow set. All
 * entries live in `.content`, NIP-44-encrypted to self with the identity key,
 * so the social graph is never exposed — only the user's own devices can read
 * it. Replaceable: the latest event always reflects the latest local state.
 */
async function publishContactSet(
  accountPubkey: string,
  signer: Signer,
): Promise<'done' | 'superseded'> {
  if (!signer.nip44Encrypt) return 'done';
  const { state, entries } = await db.transaction(async (tx) => ({
    state: await readSyncState(accountPubkey, tx),
    entries: await tx
      .select({ pubkey: contacts.pubkey, petname: contacts.petname })
      .from(contacts)
      .where(eq(contacts.accountPubkey, accountPubkey)),
  }));
  if (!state?.dirty) return 'done';
  const key = { pubkey: accountPubkey, kind: KIND_FOLLOW_SET, dTag: CONTACTS_D };
  const previous = await getReplaceableEvent(key);
  // NIP-51 / NIP-02 p-tag shape: ["p", pubkey, relay, petname]. We don't pin a
  // relay, so slot 2 stays empty; the petname rides in slot 3 when set.
  const privateTags = entries.map((e) =>
    e.petname ? ['p', e.pubkey, '', e.petname] : ['p', e.pubkey],
  );
  const content = await signer.nip44Encrypt(accountPubkey, JSON.stringify(privateTags));
  const event = await signer.signEvent({
    kind: KIND_FOLLOW_SET,
    content,
    tags: [
      ['d', CONTACTS_D],
      ['title', CONTACTS_TITLE],
    ],
    // Seconds are too coarse for consecutive edits; every snapshot must win
    // over both the cached event and the last locally reconciled version.
    created_at: Math.max(
      Math.floor(Date.now() / 1000),
      (previous?.created_at ?? 0) + 1,
      (state.eventCreatedAt ?? 0) + 1,
    ),
  });
  if ((await readSyncState(accountPubkey))?.revision !== state.revision) return 'superseded';
  const latest = await getReplaceableEvent(key);
  if (latest && latest.created_at >= event.created_at) return 'superseded';
  // Atomically cache and enqueue the signed snapshot before clearing its dirty
  // revision. The pending queue protects this snapshot until a relay quorum accepts it.
  const accepted = await enqueueConfigurationEvent(event, async (_event, tx) => {
    // The queue now owns delivery. A newer local revision still needs signing.
    await tx.update(contactSyncState).set({
      eventCreatedAt: event.created_at, eventId: event.id, dirty: false,
    }).where(and(
      eq(contactSyncState.accountPubkey, accountPubkey),
      eq(contactSyncState.revision, state.revision),
    ));
  });
  if (!accepted) return 'superseded';
  return 'done';
}

type PublishJob = { requested: boolean; signer?: Signer };
const publishJobs = new Map<string, PublishJob>();

/** Coalesce edits and serialize signing/publication per account. A failed job
 * leaves its durable dirty revision for the next edit or personal-config sync.
 * Crypto starts on a later macrotask so the local result can paint first. */
function publishContactSetInBackground(accountPubkey: string, signer?: Signer): void {
  const existing = publishJobs.get(accountPubkey);
  if (existing) {
    existing.requested = true;
    if (signer) existing.signer = signer;
    return;
  }
  const job: PublishJob = { requested: true, signer };
  publishJobs.set(accountPubkey, job);
  setTimeout(() => {
    void (async () => {
      try {
        while (job.requested) {
          job.requested = false;
          try {
            const s = job.signer ?? (await buildSigner(accountPubkey));
            if ((await publishContactSet(accountPubkey, s)) === 'superseded') job.requested = true;
          } catch {
            // Keep the pending revision even if encryption, signing, or publication fails.
          }
          if (job.requested) await new Promise((resolve) => setTimeout(resolve, 0));
        }
      } finally {
        publishJobs.delete(accountPubkey);
      }
    })();
  }, 0);
}

/** Add a contact locally then re-publish the synced set. Idempotent. */
export async function addContact(
  accountPubkey: string,
  pubkey: string,
  opts: { source?: 'manual' | 'auto'; signer?: Signer } = {},
): Promise<void> {
  await db.transaction(async (tx) => {
    await markContactsDirty(accountPubkey, tx);
    await tx
      .insert(contacts)
      .values({
        accountPubkey,
        pubkey,
        addedAt: Math.floor(Date.now() / 1000),
        source: opts.source ?? 'manual',
      })
      .onConflictDoNothing();
    // An explicit contact's conversation belongs in the main inbox: graduate any
    // existing 1:1 thread out of Requests now, rather than waiting for the next
    // message to flip hasReplied.
    // conversation_key is the counterparty pubkey (self included, for note-to-self).
    const conversationKey = pubkey;
    await tx
      .update(conversations)
      .set({ hasReplied: true })
      .where(
        and(
          eq(conversations.accountPubkey, accountPubkey),
          eq(conversations.conversationKey, conversationKey),
          eq(conversations.hasReplied, false),
        ),
      );
  });
  publishContactSetInBackground(accountPubkey, opts.signer);
}

/**
 * Set (or clear) the local nickname for a pubkey. Setting a petname implies
 * saving the contact — Telegram-style "Edit". Pass an empty string to clear.
 */
export async function setPetname(
  accountPubkey: string,
  pubkey: string,
  petname: string,
  opts: { signer?: Signer } = {},
): Promise<void> {
  const value = petname.trim() || null;
  await db.transaction(async (tx) => {
    await markContactsDirty(accountPubkey, tx);
    await tx
      .insert(contacts)
      .values({
        accountPubkey,
        pubkey,
        addedAt: Math.floor(Date.now() / 1000),
        source: 'manual',
        petname: value,
      })
      .onConflictDoUpdate({
        target: [contacts.accountPubkey, contacts.pubkey],
        set: { petname: value },
      });
  });
  publishContactSetInBackground(accountPubkey, opts.signer);
}

/** Remove a contact locally then re-publish the synced set. */
export async function removeContact(
  accountPubkey: string,
  pubkey: string,
  opts: { signer?: Signer } = {},
): Promise<void> {
  await db.transaction(async (tx) => {
    await markContactsDirty(accountPubkey, tx);
    await tx
      .delete(contacts)
      .where(and(eq(contacts.accountPubkey, accountPubkey), eq(contacts.pubkey, pubkey)));
    // The conversation and its flags are independent of contact status: mute can
    // apply to a non-contact (e.g. a request spammer), and pin is a device-local
    // inbox sort preference — neither is touched here. Only the contact delete is
    // awaited; the re-publish runs in the background.
  });
  publishContactSetInBackground(accountPubkey, opts.signer);
}

/** Reconcile a remote snapshot only when there are no unpublished local edits.
 * Recheck the durable revision/watermark after asynchronous decryption, inside
 * the write transaction, so a late result cannot undo an intervening edit. */
export async function applyContactsEvent(
  accountPubkey: string,
  event: Event | null,
  signer: Signer,
): Promise<void> {
  const state = await readSyncState(accountPubkey);
  if (state?.dirty) {
    // A relay echo must not turn an in-flight publish into a retry loop.
    if (!publishJobs.has(accountPubkey)) publishContactSetInBackground(accountPubkey, signer);
    return;
  }
  if (await getPendingConfiguration(accountPubkey, KIND_FOLLOW_SET, CONTACTS_D)) return;
  if (!event || !signer.nip44Decrypt) return;
  if (state?.eventId === event.id) return;
  const latest = await getReplaceableEvent({
    pubkey: accountPubkey,
    kind: KIND_FOLLOW_SET,
    dTag: CONTACTS_D,
  });
  if (latest && (
    latest.created_at > event.created_at ||
    (latest.created_at === event.created_at && latest.id !== event.id)
  )) return;
  let remote: { pubkey: string; petname: string | null }[];
  try {
    const json = await signer.nip44Decrypt(accountPubkey, event.content);
    const tags = JSON.parse(json) as string[][];
    remote = tags
      .filter((t) => t[0] === 'p' && t[1])
      .map((t) => ({ pubkey: t[1], petname: t[3]?.trim() || null }));
  } catch {
    return; // undecryptable / malformed — leave local state untouched
  }

  const remotePubkeys = remote.map((r) => r.pubkey);
  const now = Math.floor(Date.now() / 1000);
  await db.transaction(async (tx) => {
    const state = await readSyncState(accountPubkey, tx);
    if (state?.dirty) return;
    if (await getPendingConfiguration(accountPubkey, KIND_FOLLOW_SET, CONTACTS_D, tx)) return;
    if (state?.eventCreatedAt != null && state.eventCreatedAt >= event.created_at) return;
    await tx
      .insert(contactSyncState)
      .values({ accountPubkey, eventCreatedAt: event.created_at, eventId: event.id })
      .onConflictDoUpdate({
        target: contactSyncState.accountPubkey,
        set: { eventCreatedAt: event.created_at, eventId: event.id },
      });
    if (remotePubkeys.length > 0) {
      await tx
        .delete(contacts)
        .where(
          and(
            eq(contacts.accountPubkey, accountPubkey),
            notInArray(contacts.pubkey, remotePubkeys),
          ),
        )
        .run();
    } else {
      await tx.delete(contacts).where(eq(contacts.accountPubkey, accountPubkey)).run();
    }
    for (const { pubkey, petname } of remote) {
      await tx
        .insert(contacts)
        .values({ accountPubkey, pubkey, addedAt: now, source: 'manual', petname })
        .onConflictDoUpdate({
          target: [contacts.accountPubkey, contacts.pubkey],
          set: { petname },
        })
        .run();
    }
    // Graduate any 1:1 thread with a (now-)contact out of Requests — the bulk
    // equivalent of what `addContact` does for one. On a fresh login, history
    // backfills before this set syncs, so those conversations were stored with
    // `hasReplied = false` (the contacts table was still empty); without this
    // they'd stay stuck in Requests even though the peer is a saved contact.
    // One-way (false → true only), so a replied/outgoing thread is never demoted.
    if (remotePubkeys.length > 0) {
      // conversation_key is the counterparty pubkey, so these are the keys.
      const contactConversationKeys = remotePubkeys;
      await tx
        .update(conversations)
        .set({ hasReplied: true })
        .where(
          and(
            eq(conversations.accountPubkey, accountPubkey),
            inArray(conversations.conversationKey, contactConversationKeys),
            eq(conversations.hasReplied, false),
          ),
        )
        .run();
    }
  });
}
