import { vaultAccess } from '@/platform/vault-access';
import type { MessagingDecryption, VaultKey } from '@/platform/ports/key-vault';
import {
  finalizeEvent,
  generateSecretKey,
  getEventHash,
  nip44,
  verifyEvent,
  validateEvent,
  type Event,
  type EventTemplate,
} from 'nostr-tools';

import type { Rumor } from '@/db/schema/types';
import {
  profileAsync,
  profileSync,
  type PerfSpan,
} from '@/lib/perf/profiler';

import { getConversationKeyAsync } from './conversation-key-cache';

/**
 * Sign a seal (kind 13) with the account's **identity** key. The seal is signed
 * by the identity — not the DM encryption key — so the recipient can verify the
 * rumor's claimed author actually sent it (NIP-17 authenticity). Provided by the
 * caller as the identity `Signer.signEvent`, since the identity privkey may live
 * behind a remote signer the crypto layer must not touch.
 */
export type SignSeal = (template: EventTemplate) => Promise<Event>;

/** Tag on a seal carrying the sender's DM encryption pubkey — mirrors kind
 * 10044's `n` tag. See `createSeal` for why it's needed. */
const SEAL_ENCRYPTION_PUBKEY_TAG = 'n';

export const KIND_SEAL = 13;
export const KIND_GIFT_WRAP = 1059;
export const KIND_CHAT = 14;
export const KIND_FILE = 15;
export const KIND_REACTION = 7;
export const KIND_CLIENT_KEY_ANNOUNCEMENT = 4454;
export const KIND_KEY_TRANSFER = 4455;
export const KIND_ENCRYPTION_KEY_ANNOUNCEMENT = 10044;
export const KIND_DM_RELAY_LIST = 10050;
/** NIP-65 "Relay List Metadata": a user's advertised read/write (outbox/inbox)
 * relays. The backbone of the outbox model — to find a peer's events you read
 * their write relays; everyone bootstraps this list from the big discovery
 * relays. */
export const KIND_RELAY_LIST_METADATA = 10002;

const DM_TIME_RANDOMIZATION_SECONDS = 2 * 24 * 60 * 60; // 2 days, per NIP-59

function randomTimeUpTo2DaysInThePast(): number {
  const now = Math.floor(Date.now() / 1000);
  return now - Math.floor(Math.random() * DM_TIME_RANDOMIZATION_SECONDS);
}

/** Build an unsigned rumor (no `sig`) and compute its NIP-01 id. */
export function buildRumor(template: EventTemplate, senderPubkey: string): Rumor {
  const unsigned = {
    ...template,
    pubkey: senderPubkey,
  };
  const id = getEventHash(unsigned as unknown as Event);
  return { ...unsigned, id } as Rumor;
}

/**
 * Build a seal (kind 13): the rumor NIP-44'd to the recipient's **encryption**
 * key, then signed by the sender's **identity** key (via `signSeal`).
 *
 * Two keys are deliberately split: encryption (NIP-44 content) vs. identity
 * (signature). This is what lets the identity signer stay out of the decryption
 * path while still proving authenticity — the recipient checks `verifyEvent` and
 * that `seal.pubkey === rumor.pubkey` on unwrap.
 *
 * Because the seal is now signed by the identity key, `seal.pubkey` is the
 * identity, not the encryption pubkey — so the recipient can no longer read the
 * sender's encryption pubkey off it to derive the content conversation key. We
 * therefore carry it in an `n` tag (same convention as kind 10044). This departs
 * from NIP-59's `tags: []`, but the tag sits *inside* the gift-wrap-encrypted
 * seal, so it leaks nothing to relays.
 *
 * The seal's `created_at` mirrors the rumor's, not a randomized past time. This
 * departs from NIP-59's "SHOULD randomize the seal's created_at": that
 * randomization defends timing privacy, but the seal is NIP-44'd inside the gift
 * wrap, so relays never see it — the only party who can decrypt the seal is the
 * recipient, who already reads the rumor's true `created_at` within. Randomizing
 * it would hide nothing while desyncing the seal from the message it carries.
 * The privacy-bearing layer is the **gift wrap**'s public `created_at`, which
 * stays randomized (see `createGiftWrap`).
 */
async function createSeal(
  rumor: Rumor,
  senderEncPrivkey: Uint8Array | VaultKey,
  senderEncPubkey: string,
  recipientEncPubkey: string,
  signSeal: SignSeal,
  unifiedKey: boolean,
): Promise<Event> {
  // Recipient's encryption pubkey is stable → cache the conversation key.
  const encryptedContent = senderEncPrivkey instanceof Uint8Array
    ? nip44.v2.encrypt(JSON.stringify(rumor), await getConversationKeyAsync(senderEncPrivkey, recipientEncPubkey, { cache: true }))
    : await vaultAccess.execute({ method: 'crypto', key: senderEncPrivkey, algorithm: 'nip44',
      operation: 'encrypt', peer: recipientEncPubkey, text: JSON.stringify(rumor) }) as string;
  return signSeal({
    kind: KIND_SEAL,
    content: encryptedContent,
    // A proximity identity deliberately uses one key for signing and NIP-44.
    // In that standard NIP-59 shape the seal pubkey is already the encryption
    // pubkey, so the relay-only split-key extension is unnecessary.
    tags: unifiedKey ? [] : [[SEAL_ENCRYPTION_PUBKEY_TAG, senderEncPubkey]],
    created_at: rumor.created_at,
  });
}

async function createGiftWrap(
  seal: Event,
  recipientMainPubkey: string,
  recipientEncPubkey: string,
): Promise<Event> {
  const ephemeralPrivkey = generateSecretKey();
  // Ephemeral one-shot key (fresh per message) → never cache: it can't repeat.
  const conversationKey = await getConversationKeyAsync(ephemeralPrivkey, recipientEncPubkey);
  const encryptedContent = nip44.v2.encrypt(JSON.stringify(seal), conversationKey);
  return finalizeEvent(
    {
      kind: KIND_GIFT_WRAP,
      content: encryptedContent,
      // Route and authorize relay access by the stable identity. The encryption
      // key is already used to encrypt the content and need not be exposed as a
      // second public recipient tag.
      tags: [['p', recipientMainPubkey]],
      created_at: randomTimeUpTo2DaysInThePast(),
    },
    ephemeralPrivkey,
  );
}

export type GiftWrappedMessage = {
  rumor: Rumor;
  seal: Event;
  giftWrap: Event;
};

export async function createGiftWrappedMessage(opts: {
  rumorTemplate: EventTemplate;
  senderIdentityPubkey: string;
  senderEncPrivkey?: Uint8Array;
  senderEncKey?: VaultKey;
  senderEncPubkey: string;
  recipientIdentityPubkey: string;
  recipientEncPubkey: string;
  signSeal: SignSeal;
}): Promise<GiftWrappedMessage> {
  const encryptionKey = opts.senderEncKey ?? opts.senderEncPrivkey;
  if (!encryptionKey) throw new Error('Missing sender encryption key');
  const rumor = buildRumor(opts.rumorTemplate, opts.senderIdentityPubkey);
  const seal = await createSeal(
    rumor,
    encryptionKey,
    opts.senderEncPubkey,
    opts.recipientEncPubkey,
    opts.signSeal,
    opts.senderIdentityPubkey === opts.senderEncPubkey,
  );
  const giftWrap = await createGiftWrap(seal, opts.recipientIdentityPubkey, opts.recipientEncPubkey);
  return { rumor, seal, giftWrap };
}

// The sender's own copy (so their other devices pick up outgoing messages) is no
// longer a special case: it's just `createGiftWrappedMessage` with the recipient
// being the sender (recipientEncPubkey = the sender's own encryption pubkey).

export type UnwrapResult = {
  giftWrap: Event;
  seal: Event;
  rumor: Rumor;
  /** Sender's encryption pubkey (from the seal). */
  senderEncryptionPubkey: string;
};

/** Relay intake distinguishes an unsupported seal from a decryption failure.
 * Only verified, decrypted seals can be classified by their private tags. */
export type GiftWrapUnwrapOutcome =
  | { status: 'decrypted'; value: UnwrapResult }
  | { status: 'unsupported'; reason: 'missing-encryption-key-tag' }
  | { status: 'failed' };

/** Generic envelope decoder retained for unified-key Nearby envelopes. Relay
 * account intake uses the stricter `unwrapGiftWrapForAccount` boundary below. */
export async function unwrapGiftWrap(
  giftWrap: Event,
  recipientEncPrivkey: Uint8Array | VaultKey,
  profile?: PerfSpan | null,
): Promise<UnwrapResult | null> {
  const outcome = await unwrapGiftWrapAttempt(giftWrap, recipientEncPrivkey, profile);
  return outcome.status === 'decrypted' ? outcome.value : null;
}

async function unwrapGiftWrapAttempt(
  giftWrap: Event,
  recipientEncPrivkey: Uint8Array | VaultKey,
  profile?: PerfSpan | null,
): Promise<GiftWrapUnwrapOutcome> {
  try {
    if (giftWrap.kind !== KIND_GIFT_WRAP || !verifyEvent(giftWrap)) return { status: 'failed' };
    // Gift wrap's pubkey is the sender's ephemeral one-shot key (different every
    // message) → never cache; it can't repeat.
    const sealJson = await profileAsync(profile, 'crypto.outerDecrypt', async () =>
      recipientEncPrivkey instanceof Uint8Array
        ? nip44.v2.decrypt(giftWrap.content, await getConversationKeyAsync(recipientEncPrivkey, giftWrap.pubkey))
        : await vaultAccess.execute({ method: 'crypto', key: recipientEncPrivkey, algorithm: 'nip44',
          operation: 'decrypt', cache: false, peer: giftWrap.pubkey, text: giftWrap.content }) as string,
    );
    const seal = profileSync(profile, 'crypto.outerParse', () => JSON.parse(sealJson) as Event);
    if (seal.kind !== KIND_SEAL) return { status: 'failed' };
    // Authenticity: the seal must carry a valid signature from the sender's
    // identity key. Without this anyone could substitute the seal in transit.
    if (!profileSync(profile, 'crypto.verifySeal', () => verifyEvent(seal))) return { status: 'failed' };

    const encryptionKeyTag = seal.tags.find((tag) => tag[0] === SEAL_ENCRYPTION_PUBKEY_TAG);
    // Only the generic unified-key decoder may fall back to the seal author.
    // A present but malformed n tag is not evidence of an ordinary NIP-17 seal.
    const senderEncryptionPubkey = encryptionKeyTag ? encryptionKeyTag[1] : seal.pubkey;
    if (!senderEncryptionPubkey || !/^[0-9a-f]{64}$/i.test(senderEncryptionPubkey)) {
      return { status: 'failed' };
    }

    // Sender's encryption pubkey is stable → cache. This is the big receive-path
    // win: every later message from the same sender reuses this conversation key.
    const rumorJson = await profileAsync(profile, 'crypto.innerDecrypt', async () =>
      recipientEncPrivkey instanceof Uint8Array
        ? nip44.v2.decrypt(seal.content, await getConversationKeyAsync(recipientEncPrivkey, senderEncryptionPubkey, { cache: true }))
        : await vaultAccess.execute({ method: 'crypto', key: recipientEncPrivkey, algorithm: 'nip44',
          operation: 'decrypt', peer: senderEncryptionPubkey, text: seal.content }) as string,
    );
    const rumor = profileSync(profile, 'crypto.innerParse', () => JSON.parse(rumorJson) as Rumor);

    // Bind identity to content: the seal is signed by `seal.pubkey`, the rumor
    // claims author `rumor.pubkey`. They MUST match — otherwise someone
    // re-sealed another author's rumor under their own signature. This binding
    // is exactly what signing the seal with the encryption key could not give.
    if (!validateEvent(rumor) || !Number.isSafeInteger(rumor.created_at) || rumor.created_at < 0 ||
      !Number.isSafeInteger(rumor.kind) || rumor.kind < 0 ||
      seal.pubkey !== rumor.pubkey || rumor.id !== getEventHash(rumor)) return { status: 'failed' };

    return {
      status: 'decrypted',
      value: { giftWrap, seal, rumor, senderEncryptionPubkey },
    };
  } catch {
    return { status: 'failed' };
  }
}

/** The vault selects and retains messaging keys; business code validates the decrypted rumor. */
export async function unwrapGiftWrapForAccount(
  giftWrap: Event,
  account: string,
  profile?: PerfSpan | null,
): Promise<GiftWrapUnwrapOutcome> {
  const result = await profileAsync(profile, 'crypto.decryptMessaging', () =>
    vaultAccess.execute({ method: 'decryptMessaging', account, event: giftWrap }),
  ) as MessagingDecryption;
  if (result.status !== 'decrypted') return result;
  try {
    const rumor = JSON.parse(result.rumorJson) as Rumor;
    if (!validateEvent(rumor) || !Number.isSafeInteger(rumor.created_at) || rumor.created_at < 0 ||
      !Number.isSafeInteger(rumor.kind) || rumor.kind < 0 ||
      result.seal.pubkey !== rumor.pubkey || rumor.id !== getEventHash(rumor)) return { status: 'failed' };
    return { status: 'decrypted', value: {
      giftWrap, seal: result.seal, rumor, senderEncryptionPubkey: result.senderEncryptionPubkey,
    } };
  } catch {
    return { status: 'failed' };
  }
}
