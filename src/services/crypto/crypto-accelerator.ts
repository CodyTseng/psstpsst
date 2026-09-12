import { platform } from '@/platform';

/**
 * Thin hex-conversion wrappers over the cryptographic accelerator port. The
 * port reports unavailability (or a failed native call) as null, and callers
 * fall back to the nostr-tools JS implementation — see
 * `crypto/conversation-key-cache.ts` and `relay/relay-pool.ts`.
 */

export function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

export function hexToBytes(hex: string): Uint8Array {
  if (hex.length % 2 !== 0) throw new Error('Invalid hex string');
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

export async function getAcceleratedNip44ConversationKey(
  privkey: Uint8Array,
  pubkeyHex: string,
): Promise<Uint8Array | null> {
  try {
    const keyHex = await platform.cryptoAccelerator.getNip44ConversationKey(
      bytesToHex(privkey),
      pubkeyHex,
    );
    return keyHex ? hexToBytes(keyHex) : null;
  } catch {
    return null;
  }
}

export function verifyAcceleratedSchnorr(
  signatureHex: string,
  messageHex: string,
  pubkeyHex: string,
): boolean | null {
  return platform.cryptoAccelerator.verifySchnorr(signatureHex, messageHex, pubkeyHex);
}
