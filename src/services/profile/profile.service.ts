import { eq, inArray } from 'drizzle-orm';
import type { Event } from 'nostr-tools';

import { db } from '@/db/client';
import { profiles } from '@/db/schema';
import { normalizeRelayUrl } from '@/lib/nostr/relay-url';

import { prepareConfiguration, publishConfiguration } from '../relay/configuration-publish.service';
import { fetchReplaceable, peerMetaRelays } from '../relay/relay-router';
import type { Signer } from '../signer/signer.interface';

const KIND_PROFILE = 0;
export const PROFILE_TTL_SECONDS = 24 * 60 * 60;

export type ParsedProfile = {
  name?: string;
  displayName?: string;
  picture?: string;
  nip05?: string;
  lud06?: string;
  lud16?: string;
  about?: string;
  banner?: string;
  website?: string;
};

/** Parse a kind-0 metadata content string. `banner`/`website` aren't cached as
 * columns — read them from here off the stored rawEvent when rendering. */
export function parseProfileContent(content: string): ParsedProfile {
  try {
    const json = JSON.parse(content);
    const str = (v: unknown) => (typeof v === 'string' && v.length > 0 ? v : undefined);
    return {
      name: str(json.name),
      displayName: str(json.display_name) ?? str(json.displayName),
      picture: str(json.picture),
      nip05: str(json.nip05),
      lud06: str(json.lud06),
      lud16: str(json.lud16),
      about: str(json.about),
      banner: str(json.banner),
      website: str(json.website),
    };
  } catch {
    return {};
  }
}

/** Fetch and cache a single profile (kind 0). */
export async function fetchProfile(pubkey: string, relays: string[] = []): Promise<void> {
  return fetchProfiles([pubkey], relays);
}

/** Persist a kind-0 event into the local profile cache, newest-wins against the
 * already cached replaceable event. A relay query can miss a fresher publish
 * stored locally, so the DB write itself must guard against stale events. */
async function storeProfileEvent(event: Event): Promise<void> {
  const existing = await getProfile(event.pubkey);
  const existingCreatedAt = existing?.rawEvent?.created_at;
  const now = Math.floor(Date.now() / 1000);
  if (existingCreatedAt != null && existingCreatedAt >= event.created_at) {
    // The cached event is already this one or newer — but the relay round trip
    // did happen, so refresh the TTL marker. Without this a static profile
    // would go stale every PROFILE_TTL_SECONDS and re-query forever.
    await db.update(profiles).set({ fetchedAt: now }).where(eq(profiles.pubkey, event.pubkey));
    return;
  }

  const parsed = parseProfileContent(event.content);
  const fields = {
    name: parsed.name ?? null,
    displayName: parsed.displayName ?? null,
    picture: parsed.picture ?? null,
    nip05: parsed.nip05 ?? null,
    lud06: parsed.lud06 ?? null,
    lud16: parsed.lud16 ?? null,
    about: parsed.about ?? null,
    rawEvent: event,
    fetchedAt: now,
  };
  await db
    .insert(profiles)
    .values({ pubkey: event.pubkey, ...fields })
    .onConflictDoUpdate({ target: profiles.pubkey, set: fields });
}

/** Seed the shared profile cache from a resolved kind-0 event reference. */
export async function cacheProfileEvent(event: Event): Promise<void> {
  if (event.kind !== KIND_PROFILE) return;
  await storeProfileEvent(event);
}

/**
 * Fetch and cache profiles for many pubkeys. Each is read from its author's
 * outbox relays (NIP-65 write relays, count-guarded, ∪ discovery); the shared
 * {@link fetchReplaceable} loader coalesces same-relay-set requests into single
 * REQs and dedups concurrent ones, so this never opens a REQ per pubkey.
 *
 * Cache-first: rows whose `fetchedAt` is within {@link PROFILE_TTL_SECONDS}
 * are served from the table with no relay traffic — this DB-side gate is the
 * authoritative one (the hook layer's own TTL check is only a fast path over
 * unresolved cold-start state). A pubkey whose query comes back empty is
 * negative-cached (stub row / fetchedAt bump) so a persistent miss doesn't
 * re-query on every mount.
 */
export async function fetchProfiles(pubkeys: string[], relays: string[] = []): Promise<void> {
  if (pubkeys.length === 0) return;

  // TTL gate: only genuinely stale (or never-fetched) pubkeys hit the relays.
  const now = Math.floor(Date.now() / 1000);
  const rows = await db
    .select({ pubkey: profiles.pubkey, fetchedAt: profiles.fetchedAt })
    .from(profiles)
    .where(inArray(profiles.pubkey, pubkeys));
  const fetchedAtByPubkey = new Map(rows.map((row) => [row.pubkey, row.fetchedAt]));
  const stalePubkeys = pubkeys.filter((pubkey) => {
    const fetchedAt = fetchedAtByPubkey.get(pubkey);
    return fetchedAt == null || now - fetchedAt > PROFILE_TTL_SECONDS;
  });
  if (stalePubkeys.length === 0) return;

  const extra = relays.map(normalizeRelayUrl);

  // Two phases so the loader actually coalesces: resolve every peer's outbox
  // first (those 10002 lookups all hit discovery, so they batch into one REQ),
  // THEN fire all the profile fetches synchronously in a single tick — same-
  // relay-set ones merge into one REQ instead of opening one per pubkey.
  const metaRelaysList = await Promise.all(stalePubkeys.map((pk) => peerMetaRelays(pk)));
  const events = await Promise.all(
    stalePubkeys.map((pubkey, i) => {
      const metaRelays = metaRelaysList[i];
      const targets = extra.length ? Array.from(new Set([...extra, ...metaRelays])) : metaRelays;
      return fetchReplaceable(targets, KIND_PROFILE, pubkey);
    }),
  );

  const fetchedPubkeys = new Set<string>();
  for (const event of events) {
    if (event) {
      fetchedPubkeys.add(event.pubkey);
      await storeProfileEvent(event);
    }
  }

  // Negative cache: a miss still counts as "checked just now". Upsert a stub
  // (rawEvent and parsed columns stay null — every consumer reads a null-event
  // row as "no profile") or bump the existing row's fetchedAt; the conflict
  // path deliberately touches only fetchedAt so a profile stored concurrently
  // is never clobbered.
  const missedPubkeys = stalePubkeys.filter((pubkey) => !fetchedPubkeys.has(pubkey));
  await Promise.all(
    missedPubkeys.map((pubkey) =>
      db
        .insert(profiles)
        .values({ pubkey, fetchedAt: now })
        .onConflictDoUpdate({ target: profiles.pubkey, set: { fetchedAt: now } }),
    ),
  );
}

export async function getProfile(pubkey: string) {
  const rows = await db.select().from(profiles).where(eq(profiles.pubkey, pubkey)).limit(1);
  return rows[0] ?? null;
}

export type ProfileMetadataInput = {
  /** Maps to name + display_name (+ displayName for cross-client compat). */
  name?: string;
  about?: string;
  website?: string;
  picture?: string;
  banner?: string;
  nip05?: string;
  lud06?: string;
  lud16?: string;
};

/**
 * Publish the account's kind-0 metadata and refresh the local cache. Merges
 * over the previously seen content so fields we don't edit (e.g. banner) survive.
 */
export async function saveProfile(opts: {
  signer: Signer;
  accountPubkey: string;
  metadata: ProfileMetadataInput;
  relays: string[];
}): Promise<void> {
  return prepareConfiguration(opts.accountPubkey, 0, '', async () => {
    const existing = await getProfile(opts.accountPubkey);
    let content: Record<string, unknown> = {};
    if (existing?.rawEvent?.content) {
      try {
        const parsed = JSON.parse(existing.rawEvent.content);
        if (parsed && typeof parsed === 'object') content = parsed;
      } catch {
        // ignore malformed prior content
      }
    }

    const m = opts.metadata;
    if (m.name !== undefined) {
      content.name = m.name;
      content.display_name = m.name;
      content.displayName = m.name;
    }
    if (m.about !== undefined) content.about = m.about;
    if (m.website !== undefined) content.website = m.website;
    if (m.picture !== undefined) content.picture = m.picture;
    if (m.banner !== undefined) content.banner = m.banner;
    if (m.nip05 !== undefined) content.nip05 = m.nip05;
    if (m.lud06 !== undefined) content.lud06 = m.lud06;
    if (m.lud16 !== undefined) content.lud16 = m.lud16;

    const contentStr = JSON.stringify(content);
    const parsed = parseProfileContent(contentStr);
    await publishConfiguration(opts.accountPubkey, opts.signer, {
      kind: 0,
      content: contentStr,
      created_at: Math.max(Math.floor(Date.now() / 1000), (existing?.rawEvent?.created_at ?? 0) + 1),
      tags: [],
    }, async (event, tx) => {
      const fields = {
        name: parsed.name ?? null,
        displayName: parsed.displayName ?? null,
        picture: parsed.picture ?? null,
        nip05: parsed.nip05 ?? null,
        lud06: parsed.lud06 ?? null,
        lud16: parsed.lud16 ?? null,
        about: parsed.about ?? null,
        rawEvent: event,
        fetchedAt: Math.floor(Date.now() / 1000),
      };
      await tx.insert(profiles).values({ pubkey: opts.accountPubkey, ...fields })
        .onConflictDoUpdate({ target: profiles.pubkey, set: fields });
    });
  });
}
