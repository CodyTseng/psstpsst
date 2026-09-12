import { requireOptionalNativeModule } from 'expo-modules-core';

import type { CryptoAcceleratorPort } from '../ports/crypto-accelerator';

/**
 * The ExpoCryptoAccelerator native module may be absent (Expo Go, or a dev client built
 * before the module was added). `requireOptionalNativeModule` returns null
 * instead of throwing, and we cache the lookup; every operation returns null
 * when the module (or the method on it) is missing or the native call fails,
 * so callers fall back to the JS implementation unchanged.
 */
type ExpoCryptoAcceleratorModule = {
  getNip44ConversationKeyAsync?: (privkeyHex: string, pubkeyHex: string) => Promise<string>;
  verifySchnorr?: (signatureHex: string, messageHex: string, pubkeyHex: string) => boolean;
};

let cached: ExpoCryptoAcceleratorModule | null | undefined;
function load(): ExpoCryptoAcceleratorModule | null {
  if (cached !== undefined) return cached;
  cached =
    requireOptionalNativeModule<ExpoCryptoAcceleratorModule>('ExpoCryptoAccelerator') ?? null;
  return cached;
}

/** Cryptographic accelerator backed by the ExpoCryptoAccelerator native module. */
export const cryptoAcceleratorAdapter: CryptoAcceleratorPort = {
  isAvailable: () => load() !== null,

  async getNip44ConversationKey(privkeyHex, pubkeyHex) {
    const fn = load()?.getNip44ConversationKeyAsync;
    if (!fn) return null;
    try {
      return await fn(privkeyHex, pubkeyHex);
    } catch {
      return null;
    }
  },

  verifySchnorr(signatureHex, messageHex, pubkeyHex) {
    const fn = load()?.verifySchnorr;
    if (!fn) return null;
    try {
      return fn(signatureHex, messageHex, pubkeyHex);
    } catch {
      return null;
    }
  },
};
