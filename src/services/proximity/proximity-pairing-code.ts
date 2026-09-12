import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, concatBytes, hexToBytes } from '@noble/hashes/utils.js';

const PAIRING_CODE_VERSION = Uint8Array.of(0x01);
const PUBKEY_PATTERN = /^[0-9a-f]{64}$/;

function normalizePubkey(pubkey: string): string {
  const normalized = pubkey.toLowerCase();
  if (!PUBKEY_PATTERN.test(normalized)) {
    throw new Error('Invalid proximity public key');
  }
  return normalized;
}

/** Stable human-comparable fingerprint for one pair of proximity identities. */
export function proximityPairingCode(localPubkey: string, peerPubkey: string): string {
  const pubkeys = [normalizePubkey(localPubkey), normalizePubkey(peerPubkey)].sort();
  const digest = bytesToHex(
    sha256(
      concatBytes(
        PAIRING_CODE_VERSION,
        hexToBytes(pubkeys[0]),
        hexToBytes(pubkeys[1]),
      ),
    ),
  ).slice(0, 8).toUpperCase();
  return `${digest.slice(0, 4)} ${digest.slice(4)}`;
}
