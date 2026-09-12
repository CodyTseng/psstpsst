import { randomBytes } from '@noble/ciphers/utils.js';

import { bytesToHex, hexToBytes } from '@/lib/nostr/keys';
import { platform } from '@/platform';

/**
 * Per-file random AES-256-GCM encryption. The key + nonce travel with the
 * message in NIP-17 kind-15 tags (themselves sealed by NIP-17), so the
 * Blossom server never sees plaintext.
 *
 * Runs on the `deviceCrypto` platform port, whose AES-GCM + SHA-256 execute
 * **asynchronously on a native thread** — a multi-MB blob no longer blocks the
 * single JS thread (the old `@noble/ciphers` path was synchronous and froze
 * the UI during send/recv). The wire format is unchanged: AES-256-GCM,
 * 12-byte nonce, and the uploaded blob is `ciphertext || 16-byte GCM tag` —
 * byte-identical to the previous noble output, so blobs encrypted before this
 * change still decrypt.
 */
const KEY_LEN = 32;
const NONCE_LEN = 12;
const TAG_LEN = 16;

export type EncryptedBlob = {
  cipher: Uint8Array;
  /** sha256 of the ciphertext → NIP-17 `x` tag + Blossom blob address. */
  cipherSha256Hex: string;
  /** sha256 of the plaintext → NIP-17 `ox` tag. */
  plainSha256Hex: string;
  keyHex: string;
  nonceHex: string;
};

/**
 * Off-thread SHA-256 of a (possibly multi-MB) buffer, hex-encoded. Exported so
 * the attachment store can content-address a decrypted blob and verify it
 * against the `x`/`ox` tags without a synchronous JS-thread hash.
 */
export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  // Off-thread SHA-256 — the blob is multi-MB, so a synchronous hash would
  // freeze the JS thread just like the cipher used to.
  return platform.deviceCrypto.sha256Hex(bytes);
}

export async function encryptBytes(plain: Uint8Array): Promise<EncryptedBlob> {
  const keyBytes = randomBytes(KEY_LEN);
  // `ciphertext || tag` matches the legacy noble layout, keeping the uploaded
  // blob shape and its content address identical.
  const { cipher, nonce } = await platform.deviceCrypto.aesGcmEncrypt(
    plain,
    keyBytes,
    NONCE_LEN,
  );
  const [cipherSha256Hex, plainSha256Hex] = await Promise.all([
    sha256Hex(cipher),
    sha256Hex(plain),
  ]);
  return {
    cipher,
    cipherSha256Hex,
    plainSha256Hex,
    keyHex: bytesToHex(keyBytes),
    nonceHex: bytesToHex(nonce),
  };
}

export async function decryptBytes(opts: {
  cipher: Uint8Array;
  keyHex: string;
  nonceHex: string;
}): Promise<Uint8Array> {
  // `opts.cipher` is `ciphertext || 16-byte tag` (our encrypt layout, and the
  // legacy noble layout for blobs predating this change).
  return platform.deviceCrypto.aesGcmDecrypt(
    opts.cipher,
    hexToBytes(opts.keyHex),
    hexToBytes(opts.nonceHex),
    TAG_LEN,
  );
}
