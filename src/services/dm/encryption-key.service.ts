import { generateSecretKey, getPublicKey, type Event } from 'nostr-tools';

import { bytesToHex, hexToBytes } from '@/lib/nostr/keys';
import { normalizeRelayUrl } from '@/lib/nostr/relay-url';
import { verificationCodeFromPubkey } from '@/lib/nostr/verification-code';
import { createPerfSpan, profileAsync, profileSync } from '@/lib/perf/profiler';
import { platform } from '@/platform';

import { nip44Decrypt, nip44Encrypt } from '../crypto/nip44';
import {
  KIND_CLIENT_KEY_ANNOUNCEMENT,
  KIND_ENCRYPTION_KEY_ANNOUNCEMENT,
  KIND_KEY_TRANSFER,
} from '../crypto/nip17-gift-wrap';
import { publishConfiguration } from '../relay/configuration-publish.service';
import { relayPool } from '../relay/relay-pool';
import type { Signer } from '../signer/signer.interface';

export type EncryptionKeypair = {
  privkey: Uint8Array;
  pubkey: string;
  /** Unix seconds when this key was generated, or first observed for a legacy
   * / transferred key whose original creation time was unavailable. */
  createdAt: number;
};

type StoredEncryptionKey = {
  privkey: string;
  createdAt: number | null;
};

// All of an account's encryption private keys, newest-first, as JSON records
// containing the key hex + creation time. keys[0] is the CURRENT key (encrypt +
// announce with it); the rest are
// retired keys kept so messages a peer encrypted to a key we've since rotated
// away from still decrypt. One list replaces the old current-key + history
// split — adding a key is just an unshift, so there is no separate "archive"
// step to forget. Per-account: a list shared across accounts would let an
// observer correlate that those accounts live on one device
// (account-unlinkability); each account's keys are wiped with it.
const SECURE_KEY_ENC_KEYS = (accountPubkey: string) => `encryption_keys_${accountPubkey}`;

// Cap on retained keys (newest-first). keys[0] is never dropped; keys past this
// count are pruned. Bounded by COUNT only — no time window (a retired key is
// cheap to keep, and automatic rotation uses a conservative cadence).
const ENC_KEYS_MAX = 10;

function isPrivateKeyHex(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{64}$/i.test(value);
}

async function readKeyList(accountPubkey: string): Promise<StoredEncryptionKey[]> {
  const raw = await platform.secureStorage.getItem(SECURE_KEY_ENC_KEYS(accountPubkey));
  if (!raw) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];

  const now = Math.floor(Date.now() / 1000);
  let migrated = false;
  const keys = parsed.flatMap((value, index): StoredEncryptionKey[] => {
    // Pre-rotation-scheduling installs stored a bare hex array. Give only the
    // current key a baseline of "first observed now" so an upgrade never
    // rotates immediately; retired-key timestamps are not used for scheduling.
    if (isPrivateKeyHex(value)) {
      migrated = true;
      return [{ privkey: value.toLowerCase(), createdAt: index === 0 ? now : null }];
    }
    if (typeof value !== 'object' || value == null) return [];
    const record = value as { privkey?: unknown; createdAt?: unknown };
    if (!isPrivateKeyHex(record.privkey)) return [];
    return [
      {
        privkey: record.privkey.toLowerCase(),
        createdAt:
          typeof record.createdAt === 'number' &&
          Number.isInteger(record.createdAt) &&
          record.createdAt > 0
            ? record.createdAt
            : null,
      },
    ];
  });
  if (keys[0]?.createdAt == null) {
    keys[0] = { ...keys[0], createdAt: now };
    migrated = true;
  }
  if (migrated) await writeKeyList(accountPubkey, keys);
  return keys;
}

async function writeKeyList(accountPubkey: string, keys: StoredEncryptionKey[]): Promise<void> {
  await platform.secureStorage.setItem(SECURE_KEY_ENC_KEYS(accountPubkey), JSON.stringify(keys));
}

function toKeypair(stored: StoredEncryptionKey): EncryptionKeypair {
  const privkey = hexToBytes(stored.privkey);
  return {
    privkey,
    pubkey: getPublicKey(privkey),
    // `readKeyList` always fills the current key. A retired legacy key can still
    // lack a meaningful timestamp, but it is never used for rotation scheduling.
    createdAt: stored.createdAt ?? 0,
  };
}

/** All of the account's encryption keys, newest-first (keys[0] = current). */
export async function loadEncryptionKeys(accountPubkey: string): Promise<EncryptionKeypair[]> {
  const profile = createPerfSpan('keys.loadEncryptionKeys');
  try {
    const keys = await profileAsync(profile, 'secureStore.readKeyList', () =>
      readKeyList(accountPubkey),
    );
    return profileSync(profile, 'crypto.toKeypairs', () => keys.map(toKeypair));
  } finally {
    profile?.end();
  }
}

/** The account's CURRENT encryption key (the newest), or null if it has none. */
export async function loadEncryptionKeypair(
  accountPubkey: string,
): Promise<EncryptionKeypair | null> {
  const [stored] = await readKeyList(accountPubkey);
  return stored ? toKeypair(stored) : null;
}

/**
 * Prepend a key as the new current one (dedupe + cap to {@link ENC_KEYS_MAX}).
 * Inserting *is* archiving: the previous current key slides to index 1, so no
 * key is ever lost by a forgotten archive step. The single write path for both
 * generating a key and importing one via Key Transfer.
 */
export async function addEncryptionKey(
  accountPubkey: string,
  privkeyHex: string,
  createdAt = Math.floor(Date.now() / 1000),
): Promise<void> {
  const hex = privkeyHex.toLowerCase();
  const existing = await readKeyList(accountPubkey);
  const matched = existing.find((key) => key.privkey === hex);
  const rest = existing.filter((key) => key.privkey !== hex);
  await writeKeyList(
    accountPubkey,
    [
      { privkey: hex, createdAt: matched?.createdAt ?? createdAt },
      ...rest,
    ].slice(0, ENC_KEYS_MAX),
  );
}

/** Generate a fresh encryption key and make it the current one (newest in the list). */
export async function generateEncryptionKeypair(accountPubkey: string): Promise<EncryptionKeypair> {
  const privkey = generateSecretKey();
  const createdAt = Math.floor(Date.now() / 1000);
  await addEncryptionKey(accountPubkey, bytesToHex(privkey), createdAt);
  return { privkey, pubkey: getPublicKey(privkey), createdAt };
}

/** Publish kind 10044 with the encryption pubkey in an `n` tag. Signed by the
 * identity signer. Broadcast to DM ∪ write ∪ discovery (see
 * {@link ownKeyAnnouncementRelays}) so the current key stays discoverable. */
export async function publishEncryptionKeyAnnouncement(opts: {
  signer: Signer;
  encryptionPubkey: string;
  relays: string[];
}): Promise<void> {
  await publishConfiguration(await opts.signer.getPublicKey(), opts.signer, {
    kind: KIND_ENCRYPTION_KEY_ANNOUNCEMENT,
    content: '',
    tags: [['n', opts.encryptionPubkey]],
    created_at: Math.floor(Date.now() / 1000),
  });
}

/** A throwaway keypair used solely to bootstrap one Key Transfer exchange.
 * EPHEMERAL by design — generated fresh per request/export and never persisted:
 * a transfer (kind 4455) is a public, NIP-44-encrypted event that lives on the
 * relay indefinitely, so reusing one long-lived client key would mean a single
 * leak of that key decrypts *every* key transfer ever addressed to it. A fresh
 * key per exchange caps the blast radius of a leak to one in-flight transfer. */
export function generateClientKeypair(): EncryptionKeypair {
  const privkey = generateSecretKey();
  return { privkey, pubkey: getPublicKey(privkey), createdAt: Math.floor(Date.now() / 1000) };
}

function findTagValue(event: Event, name: string): string | undefined {
  return event.tags.find((t) => t[0] === name)?.[1];
}

export function getEncryptionPubkeyFromEvent(event: Event): string | null {
  return findTagValue(event, 'n') ?? null;
}

/** NIP draft uses the `P` tag; coop uses `pubkey`. Accept either. */
export function getClientPubkeyFromEvent(event: Event): string | null {
  return findTagValue(event, 'P') ?? findTagValue(event, 'pubkey') ?? null;
}

/** Reply relays advertised by a key-sync request. Treat every tag as untrusted
 * input and keep only normalized WebSocket relay URLs. */
export function getKeySyncRelayHints(event: Event): string[] {
  const relays = new Set<string>();
  for (const tag of event.tags) {
    if (tag[0] !== 'relay' || !tag[1]) continue;
    try {
      relays.add(normalizeRelayUrl(tag[1]));
    } catch {
      // Ignore malformed relay hints from network events.
    }
  }
  return Array.from(relays);
}

/** Fetch the most recent kind-10044 encryption-key announcement for a pubkey. */
export async function queryEncryptionKeyAnnouncement(
  pubkey: string,
  relays: string[],
): Promise<Event | null> {
  const profile = createPerfSpan('keys.queryAnnouncement', { relays: relays.length });
  const events = await relayPool.query({
    label: 'key-announcement',
    relays,
    filter: { kinds: [KIND_ENCRYPTION_KEY_ANNOUNCEMENT], authors: [pubkey] },
  });
  try {
    if (events.length === 0) return null;
    return profileSync(profile, 'selectLatest', () =>
      events.reduce((a, b) => (b.created_at > a.created_at ? b : a)),
    );
  } finally {
    profile?.end({ events: events.length, result: events.length === 0 ? 'empty' : 'found' });
  }
}

/** Publish a kind-4454 client-key announcement to bootstrap a key request.
 * Intentionally carries no device-description tag (would leak the OS). */
export async function publishClientKeyAnnouncement(opts: {
  signer: Signer;
  clientPubkey: string;
  relays: string[];
  expectedEncryptionPubkey?: string | null;
}): Promise<Event> {
  const tags = [
    ['pubkey', opts.clientPubkey],
    ['P', opts.clientPubkey],
    ...opts.relays.map((relay) => ['relay', relay]),
  ];
  if (opts.expectedEncryptionPubkey) tags.push(['n', opts.expectedEncryptionPubkey]);
  const event = await opts.signer.signEvent({
    kind: KIND_CLIENT_KEY_ANNOUNCEMENT,
    content: '',
    tags,
    created_at: Math.floor(Date.now() / 1000),
  });
  const outcomes = await relayPool.publishEvent({
    relays: opts.relays,
    event,
    signer: opts.signer,
  });
  if (!outcomes.some((result) => result.outcome.ok)) {
    throw new Error('Key sync request failed: no relay accepted the event.');
  }
  return event;
}

/** Old device: encrypt this account's encryption privkey to the requesting
 * device's client pubkey and publish it as a kind-4455 transfer. The sender side
 * uses a throwaway keypair generated just for this transfer — the requester
 * learns its pubkey from the `P` tag to derive the same NIP-44 conversation key,
 * so nothing about the sender key needs to persist. */
export async function exportKeyForTransfer(opts: {
  signer: Signer;
  accountPubkey: string;
  recipientClientPubkey: string;
  relays: string[];
  requestedEncryptionPubkey?: string | null;
}): Promise<Event> {
  const encryptionKeys = await loadEncryptionKeys(opts.accountPubkey);
  const encryptionKeypair = opts.requestedEncryptionPubkey
    ? encryptionKeys.find((key) => key.pubkey === opts.requestedEncryptionPubkey)
    : encryptionKeys[0];
  if (!encryptionKeypair) {
    throw new Error(
      opts.requestedEncryptionPubkey
        ? 'This device does not have the encryption key requested by the other device.'
        : 'No encryption key is available to transfer.',
    );
  }
  const senderKeypair = generateClientKeypair();

  const content = await nip44Encrypt(
    bytesToHex(encryptionKeypair.privkey),
    senderKeypair.privkey,
    opts.recipientClientPubkey,
  );
  const event = await opts.signer.signEvent({
    kind: KIND_KEY_TRANSFER,
    content,
    tags: [
      ['P', senderKeypair.pubkey],
      // Route the event through inbox relays authenticated as this account. The
      // ephemeral client target remains a second p tag for exact subscription.
      ['p', opts.accountPubkey],
      ['p', opts.recipientClientPubkey],
    ],
    created_at: Math.floor(Date.now() / 1000),
  });
  const outcomes = await relayPool.publishEvent({
    relays: opts.relays,
    event,
    signer: opts.signer,
  });
  if (!outcomes.some((result) => result.outcome.ok)) {
    throw new Error('Key transfer failed: no relay accepted the event.');
  }
  return event;
}

/** New device: decrypt a kind-4455 transfer with our client key and, if it
 * yields a valid 32-byte hex privkey **whose pubkey matches the encryption key
 * currently announced on the network** (`expectedEncryptionPubkey`), store it as
 * this account's encryption key.
 *
 * The announcement match — not a since-timestamp — is what makes this
 * replay-safe: a transfer might legitimately predate our wait (another device
 * can broadcast the key to its known devices when it rotates), so we can't drop
 * older events; but a *stale* transfer carries an old privkey whose pubkey no
 * longer equals the latest kind-10044, so it's rejected and we keep waiting.
 *
 * On match, the key is prepended via {@link addEncryptionKey}, which keeps any
 * existing keys (no key is lost — there is no separate archive step). */
export async function importKeyFromTransfer(
  accountPubkey: string,
  clientPrivkey: Uint8Array,
  transferEvent: Event,
  expectedEncryptionPubkey: string | null,
  expectedEncryptionCreatedAt: number | null = null,
): Promise<boolean> {
  const senderClientPubkey = getClientPubkeyFromEvent(transferEvent);
  if (!senderClientPubkey) return false;
  try {
    const decrypted = await nip44Decrypt(
      transferEvent.content,
      clientPrivkey,
      senderClientPubkey,
    );
    if (!/^[0-9a-f]{64}$/i.test(decrypted)) return false;
    const privkeyHex = decrypted.toLowerCase();
    // Replay / cross-key guard: the key must match the current announcement.
    // If it doesn't (a stale or unrelated transfer), reject and keep waiting.
    if (expectedEncryptionPubkey) {
      const pubkey = getPublicKey(hexToBytes(privkeyHex));
      if (pubkey !== expectedEncryptionPubkey) return false;
    }
    await addEncryptionKey(
      accountPubkey,
      privkeyHex,
      expectedEncryptionCreatedAt ?? Math.floor(Date.now() / 1000),
    );
    return true;
  } catch {
    return false;
  }
}

/** New device: subscribe for an incoming kind-4455 addressed to our client
 * pubkey and import the first one that matches `expectedEncryptionPubkey`,
 * self-closing on success. `onTransfer` fires **only** on a matching import;
 * non-matching / undecryptable events are ignored so we keep waiting.
 *
 * No `since`/`limit` filter: a valid transfer may already be on the relay
 * (another device can publish the key to its known devices when it rotates, not
 * only in response to our request), so we must accept past events too. Replay
 * safety comes from the announcement match in {@link importKeyFromTransfer},
 * not a time window. */
export function subscribeToKeyTransfer(opts: {
  accountPubkey: string;
  clientKeypair: EncryptionKeypair;
  relays: string[];
  signer: Signer;
  expectedEncryptionPubkey: string | null;
  expectedEncryptionCreatedAt?: number | null;
  onTransfer: () => void;
  onRejected?: () => void;
}): () => void {
  let unsub: (() => void) | null = null;
  unsub = relayPool.subscribe({
    label: 'key-transfer',
    relays: opts.relays,
    filter: {
      kinds: [KIND_KEY_TRANSFER],
      authors: [opts.accountPubkey],
      '#p': [opts.clientKeypair.pubkey],
    },
    onEvent: (event) => {
      void importKeyFromTransfer(
        opts.accountPubkey,
        opts.clientKeypair.privkey,
        event,
        opts.expectedEncryptionPubkey,
        opts.expectedEncryptionCreatedAt,
      ).then((success) => {
        if (success) {
          opts.onTransfer();
          unsub?.();
        } else {
          opts.onRejected?.();
        }
      });
    },
    signAuth: (authEvent) => opts.signer.signEvent(authEvent),
  });
  return () => unsub?.();
}

/** Human-comparable pairing code from a client pubkey. The pubkey is uniformly
 * random, so its leading hex is already random — no hashing needed. Both
 * devices derive the same code; the user compares them before approving. */
export function getVerificationCode(clientPubkey: string): string {
  return verificationCodeFromPubkey(clientPubkey);
}

/** Wipe an account's encryption keys from secure storage. Call when removing the
 * account so nothing sensitive lingers. (The processed-sync-request log lives in
 * SQLite and is dropped with the account's other rows in `deleteAccountData`; the
 * client key is ephemeral — never persisted — so there's nothing to wipe.) */
export async function clearAccountKeyMaterial(accountPubkey: string): Promise<void> {
  await platform.secureStorage.deleteItem(SECURE_KEY_ENC_KEYS(accountPubkey));
}
