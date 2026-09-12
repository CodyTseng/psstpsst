/**
 * Port for optional platform-accelerated cryptographic calculations. It keeps
 * expensive secp256k1 work out of JavaScript while leaving protocol behavior
 * and JS fallbacks in `services/crypto`.
 *
 * Implementations must tolerate the capability being absent (Expo Go, a dev
 * client built before the native module was added, or a platform without the
 * accelerator): `isAvailable()` returns false and operations return null —
 * including when the native call itself fails — so callers fall back to the
 * JS implementation unchanged.
 *
 * `getNip44ConversationKey` is async-first (the native call already crosses the
 * bridge asynchronously). `verifySchnorr` is pure CPU with no I/O — like
 * `SqliteDriver.drizzle` it stays synchronous: the relay event-verification
 * hot path that consumes it is synchronous, and a backend that can only
 * verify asynchronously simply reports unavailable and lets the JS fallback
 * run instead.
 */
export interface CryptoAcceleratorPort {
  /** Whether the native accelerator module is present at all. */
  isAvailable(): boolean;
  /**
   * Derive the NIP-44 conversation key for (our privkey, peer pubkey), both
   * hex-encoded. Resolves to the hex-encoded key, or null when unavailable
   * or the native call fails.
   */
  getNip44ConversationKey(privkeyHex: string, pubkeyHex: string): Promise<string | null>;
  /**
   * Verify a schnorr signature over a 32-byte message hash (all hex-encoded).
   * Returns the verification result, or null when unavailable or the native
   * call fails.
   */
  verifySchnorr(signatureHex: string, messageHex: string, pubkeyHex: string): boolean | null;
}
