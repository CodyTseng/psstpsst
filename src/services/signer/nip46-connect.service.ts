import { generateSecretKey, getPublicKey } from 'nostr-tools';
import {
  BUNKER_REGEX,
  BunkerSigner,
  createNostrConnectURI,
  parseBunkerInput,
} from 'nostr-tools/nip46';

import { bytesToHex } from '@/lib/nostr/keys';
import { platform } from '@/platform';

import { addRemoteAccount } from '../account/account.service';
import { relayPool } from '../relay/relay-pool';
import {
  NIP46_PAIRING_TIMEOUT_MS,
  withNip46Timeout,
} from './nip46-timeout';

/** Default relays the two sides rendezvous on for the Nostr Connect (app-
 * initiated) flow — widely-replicated public relays most signers already speak
 * to. The user can override this via the screen's advanced setting. */
export const NIP46_DEFAULT_RELAYS = ['wss://relay.damus.io', 'wss://nos.lol'];

const APP_NAME = 'PsstPsst';

function openAuthUrl(url: string): void {
  void platform.urlOpener.openExternalUrl(url).catch((error) => {
    console.warn('[nip46] Failed to open the authorization URL.', error);
  });
}

/**
 * Connect to a bunker from a pasted `bunker://…` URL, then persist the account
 * and return its signing pubkey. We connect here (rather than lazily) because
 * the signing pubkey isn't known until the handshake completes — the bunker
 * reports it, and it may differ from the pubkey embedded in the URI. The
 * temporary connection is closed afterwards; the next use (bootstrap) reconnects
 * lazily with the same authorised client key.
 */
export async function loginWithBunker(input: string): Promise<{ pubkey: string }> {
  const trimmed = input.trim();
  // Bunker links only — `parseBunkerInput` would also resolve a `name@domain`
  // NIP-05, which we deliberately don't accept here.
  if (!BUNKER_REGEX.test(trimmed)) throw new Error('invalid');
  const pointer = await parseBunkerInput(trimmed);
  if (!pointer) throw new Error('invalid');

  const clientSecretKey = generateSecretKey();
  const signer = BunkerSigner.fromBunker(clientSecretKey, pointer, {
    pool: relayPool.underlyingPool,
    onauth: openAuthUrl,
  });
  try {
    await withNip46Timeout(signer.connect(), 'connection');
    const pubkey = await withNip46Timeout(signer.getPublicKey(), 'get_public_key');
    await addRemoteAccount({
      pubkey,
      pointer: signer.bp,
      clientSecretKeyHex: bytesToHex(clientSecretKey),
    });
    return { pubkey };
  } finally {
    await signer.close().catch(() => {});
  }
}

export type NostrConnectSession = {
  /** The `nostrconnect://…` URI — render it as a QR and as a tappable deep link. */
  uri: string;
  /** Resolves with the signing pubkey once a signer connects back; rejects if
   * cancelled. Persists the account before resolving. */
  waitForConnection: () => Promise<{ pubkey: string }>;
  /** Abort an in-flight `waitForConnection`. */
  cancel: () => void;
};

/**
 * Start the Nostr Connect (app-initiated) flow: mint a fresh client key, build a
 * `nostrconnect://` URI for the user to open in / scan with their signer, and
 * wait for the signer to connect back. The same client key is persisted so the
 * account reconnects on later launches.
 */
export function startNostrConnect(opts?: { relays?: string[] }): NostrConnectSession {
  const relays = opts?.relays?.length ? opts.relays : NIP46_DEFAULT_RELAYS;
  const clientSecretKey = generateSecretKey();
  const clientPubkey = getPublicKey(clientSecretKey);
  // A one-time secret the signer must echo back so we accept only the bunker we
  // invited (not any relay eavesdropper replaying the URI).
  const secret = bytesToHex(generateSecretKey());
  const uri = createNostrConnectURI({
    clientPubkey,
    relays,
    secret,
    name: APP_NAME,
  });

  const controller = new AbortController();

  const waitForConnection = async (): Promise<{ pubkey: string }> => {
    const signer = await withNip46Timeout(
      BunkerSigner.fromURI(
        clientSecretKey,
        uri,
        { pool: relayPool.underlyingPool, onauth: openAuthUrl },
        controller.signal,
      ),
      'connection',
      NIP46_PAIRING_TIMEOUT_MS,
      () => controller.abort(),
    );
    try {
      const pubkey = await withNip46Timeout(signer.getPublicKey(), 'get_public_key');
      await addRemoteAccount({
        pubkey,
        pointer: signer.bp,
        clientSecretKeyHex: bytesToHex(clientSecretKey),
      });
      return { pubkey };
    } finally {
      await signer.close().catch(() => {});
    }
  };

  return { uri, waitForConnection, cancel: () => controller.abort() };
}
