import { bech32 } from '@scure/base';
import { secp256k1 } from '@noble/curves/secp256k1.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, concatBytes } from '@noble/hashes/utils.js';

export const preimage = '42'.repeat(32);
export const paymentHash = bytesToHex(sha256(new Uint8Array(32).fill(0x42)));
export function invoiceFixture(options: { hrp?: string; expiry?: number; createdAt?: number; duplicateHash?: boolean; omitExpiry?: boolean; extra?: number[]; description?: string } = {}) {
  const hrp = options.hrp ?? 'lnbc10n';
  const integer = (value: number) => {
    const words: number[] = [];
    do { words.unshift(value % 32); value = Math.floor(value / 32); } while (value);
    return words;
  };
  const tag = (type: number, words: number[]) => [type, words.length >> 5, words.length & 31, ...words];
  const timestamp = integer(options.createdAt ?? Math.floor(Date.now() / 1000));
  while (timestamp.length < 7) timestamp.unshift(0);
  const hash = tag(1, bech32.toWords(sha256(new Uint8Array(32).fill(0x42))));
  const data = [...timestamp, ...hash,
    ...tag(13, bech32.toWords(new TextEncoder().encode(options.description ?? 'Test purchase'))),
    ...(options.omitExpiry ? [] : tag(6, integer(options.expiry ?? 3600))), ...(options.duplicateHash ? hash : []), ...(options.extra ?? [])];
  // Independent bit packing for the BOLT11 signing payload.
  const packed: number[] = [];
  let accumulator = 0, bits = 0;
  for (const word of data) {
    accumulator = (accumulator << 5) | word; bits += 5;
    while (bits >= 8) { bits -= 8; packed.push((accumulator >> bits) & 255); }
  }
  if (bits) packed.push((accumulator << (8 - bits)) & 255);
  const digest = sha256(concatBytes(new TextEncoder().encode(hrp), new Uint8Array(packed)));
  const signature = secp256k1.sign(digest, new Uint8Array(32).fill(1), { prehash: false, format: 'recovered' });
  return bech32.encode(hrp, [...data, ...bech32.toWords(concatBytes(signature.slice(1), signature.slice(0, 1)))], 5000);
}
