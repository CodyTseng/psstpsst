/**
 * Port for the device crypto primitives the services layer needs: UUID
 * generation, off-thread SHA-256 digests, and AES-256-GCM for per-file
 * attachment encryption (`services/files/file-crypto.ts`). On mobile the
 * digest and cipher run on a native thread so a multi-MB blob never blocks
 * the single JS thread; a desktop adapter can back them with the OS crypto
 * facility over IPC.
 *
 * The AES-GCM wire format is fixed by the attachment protocol: a 12-byte
 * nonce, and the sealed blob laid out as `ciphertext || 16-byte GCM tag`.
 * The port works purely in bytes — hex/base64 conversions are the caller's
 * business.
 *
 * All methods are async-first — see the module note in `secure-storage.ts`.
 */
export interface DeviceCryptoPort {
  /** A random RFC 4122 UUID (lowercase, hyphenated). */
  randomUUID(): Promise<string>;
  /** SHA-256 digest of `data`, lowercase hex-encoded. */
  sha256Hex(data: Uint8Array): Promise<string>;
  /**
   * AES-256-GCM encrypt with a fresh random nonce of `nonceLength` bytes.
   * Returns the sealed bytes as `ciphertext || tag` plus the generated nonce.
   */
  aesGcmEncrypt(
    plain: Uint8Array,
    key: Uint8Array,
    nonceLength: number,
  ): Promise<{ cipher: Uint8Array; nonce: Uint8Array }>;
  /**
   * AES-256-GCM decrypt of `ciphertext || tag` (the {@link aesGcmEncrypt}
   * layout; `tagLength` splits the tag off the tail). Rejects on tag mismatch.
   */
  aesGcmDecrypt(
    cipher: Uint8Array,
    key: Uint8Array,
    nonce: Uint8Array,
    tagLength: number,
  ): Promise<Uint8Array>;
  /**
   * AES-256-GCM record protection with caller-supplied 12-byte IV and AAD.
   * Returns `ciphertext || 16-byte tag`; rejects invalid key/IV sizes.
   */
  aesGcmSeal(
    plain: Uint8Array,
    key: Uint8Array,
    iv: Uint8Array,
    additionalData: Uint8Array,
  ): Promise<Uint8Array>;
  /** Open the {@link aesGcmSeal} layout and reject before returning on tag mismatch. */
  aesGcmOpen(
    cipher: Uint8Array,
    key: Uint8Array,
    iv: Uint8Array,
    additionalData: Uint8Array,
  ): Promise<Uint8Array>;
}
