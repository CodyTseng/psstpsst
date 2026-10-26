import { vaultAccess } from '@/platform/vault-access';
import { type Event } from 'nostr-tools';

import { normalizeRelayUrl } from '@/lib/nostr/relay-url';
import { verificationCodeFromPubkey } from '@/lib/nostr/verification-code';
import { createPerfSpan, profileSync } from '@/lib/perf/profiler';

import type { MessagingKey, VaultConsent } from '@/platform/ports/key-vault';
import {
  KIND_CLIENT_KEY_ANNOUNCEMENT,
  KIND_ENCRYPTION_KEY_ANNOUNCEMENT,
  KIND_KEY_TRANSFER,
} from '../crypto/nip17-gift-wrap';
import { publishConfiguration } from '../relay/configuration-publish.service';
import { relayPool } from '../relay/relay-pool';
import type { Signer } from '../signer/signer.interface';

export type EncryptionKeypair = MessagingKey;
export type ClientKeypair = MessagingKey;

/** Metadata and opaque references only; private keys stay inside the vault. */
export async function loadEncryptionKeypair(accountPubkey: string): Promise<EncryptionKeypair | null> {
  return await vaultAccess.execute({ method: 'getCurrentMessagingKey', account: accountPubkey }) as EncryptionKeypair | null;
}
export async function hasEncryptionKey(accountPubkey: string, pubkey: string): Promise<boolean> {
  return await vaultAccess.execute({ method: 'hasMessagingKey', account: accountPubkey, pubkey }) as boolean;
}
export async function generateEncryptionKeypair(accountPubkey: string): Promise<EncryptionKeypair> {
  return await vaultAccess.execute({ method: 'generateMessaging', account: accountPubkey }) as EncryptionKeypair;
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
export async function generateClientKeypair(): Promise<ClientKeypair> {
  return await vaultAccess.execute({ method: 'generateEphemeral', purpose: 'key-sync' }) as ClientKeypair;
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
  const relays = Array.from(new Set(opts.relays.map(normalizeRelayUrl)));
  const tags = [
    ['pubkey', opts.clientPubkey],
    ['P', opts.clientPubkey],
    ...relays.map((relay) => ['relay', relay]),
  ];
  if (opts.expectedEncryptionPubkey) tags.push(['n', opts.expectedEncryptionPubkey]);
  const event = await opts.signer.signEvent({
    kind: KIND_CLIENT_KEY_ANNOUNCEMENT,
    content: '',
    tags,
    created_at: Math.floor(Date.now() / 1000),
  });
  const outcomes = await relayPool.publishEvent({
    relays,
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
  confirmation: VaultConsent;
}): Promise<Event> {
  const transfer = await vaultAccess.execute({ method: 'exportTransfer', account: opts.accountPubkey,
    pubkey: opts.requestedEncryptionPubkey ?? null, recipient: opts.recipientClientPubkey,
    confirmation: opts.confirmation,
  }) as { content: string; senderPubkey: string };
  const content = transfer.content;
  const event = await opts.signer.signEvent({
    kind: KIND_KEY_TRANSFER,
    content,
    tags: [
      ['P', transfer.senderPubkey],
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
 * On match, the key is prepended inside the vault, which keeps any
 * existing keys (no key is lost — there is no separate archive step). */
export async function importKeyFromTransfer(
  accountPubkey: string,
  clientKey: ClientKeypair['key'],
  transferEvent: Event,
  expectedEncryptionPubkey: string | null,
  expectedEncryptionCreatedAt: number | null = null,
): Promise<boolean> {
  const senderClientPubkey = getClientPubkeyFromEvent(transferEvent);
  if (!senderClientPubkey) return false;
  try {
    return await vaultAccess.execute({ method: 'importTransfer', account: accountPubkey,
      client: clientKey, sender: senderClientPubkey, ciphertext: transferEvent.content,
      expectedPubkey: expectedEncryptionPubkey,
      createdAt: expectedEncryptionCreatedAt ?? Math.floor(Date.now() / 1000),
    }) as boolean;
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
  clientKeypair: ClientKeypair;
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
        opts.clientKeypair.key,
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
  await vaultAccess.execute({ method: 'removeMessaging', account: accountPubkey });
}
