import { bech32 } from '@scure/base';
import { secp256k1 } from '@noble/curves/secp256k1.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, concatBytes } from '@noble/hashes/utils.js';

/** Strict payment review: verify the checksum, signed amount, hash and expiry. */
export function webLnInvoice(input: unknown) {
  if (typeof input !== 'string' || input.length > 5000 || input !== input.trim()
    || input !== input.toLowerCase() && input !== input.toUpperCase()) throw new Error('invalid-invoice');
  const invoice = input.toLowerCase();
  const decoded = bech32.decode(invoice as `${string}1${string}`, 5000);
  const amount = decoded.prefix.match(/^ln(bc|tb|bcrt)(\d+)([munp]?)$/);
  if (!amount || decoded.words.length < 114) throw new Error('invalid-invoice');
  const factors: Record<string, bigint> = { '': 100_000_000_000n, m: 100_000_000n, u: 100_000n, n: 100n, p: 1n };
  const digits = BigInt(amount[2]);
  if (amount[3] === 'p' && digits % 10n !== 0n) throw new Error('invalid-amount');
  const msat = amount[3] === 'p' ? digits / 10n : digits * factors[amount[3]];
  if (msat <= 0n || msat > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('invalid-amount');
  const number = (words: number[]) => words.reduce((n, word) => n * 32 + word, 0);
  const data = decoded.words.slice(0, -104);
  const createdAt = number(data.slice(0, 7));
  let expiry = 3600, hash: string | undefined, payee: Uint8Array | undefined;
  let description: string | undefined;
  const seen = new Set<number>();
  for (let offset = 7; offset < data.length;) {
    if (offset + 3 > data.length) throw new Error('invalid-invoice');
    const tag = data[offset], length = data[offset + 1] * 32 + data[offset + 2];
    const end = offset + 3 + length;
    if (end > data.length) throw new Error('invalid-invoice');
    const words = data.slice(offset + 3, end);
    if ([1, 6, 13, 19, 23].includes(tag)) {
      if (seen.has(tag)) throw new Error('invalid-invoice');
      seen.add(tag);
      if (tag === 6) { expiry = number(words); if (!Number.isSafeInteger(expiry)) throw new Error('invalid-invoice'); }
      else {
        const bytes = bech32.fromWords(words);
        if (tag === 1) { if (bytes.length !== 32) throw new Error('invalid-invoice'); hash = bytesToHex(bytes); }
        if (tag === 13) description = new TextDecoder().decode(bytes);
        if (tag === 19) { if (bytes.length !== 33) throw new Error('invalid-invoice'); payee = bytes; }
        if (tag === 23 && bytes.length !== 32) throw new Error('invalid-invoice');
      }
    }
    offset = end;
  }
  if (!hash || seen.has(13) === seen.has(23)) throw new Error('invalid-invoice');
  const expiresAt = createdAt + expiry;
  if (!Number.isSafeInteger(expiresAt) || expiresAt <= Date.now() / 1000) throw new Error('invoice-expired');
  // BOLT11 hashes the HRP and zero-padded five-bit data, without the signature.
  const padded = [...data];
  while (padded.length % 8) padded.push(0);
  const signingBytes = bech32.fromWords(padded).slice(0, Math.ceil(data.length * 5 / 8));
  const digest = sha256(concatBytes(new TextEncoder().encode(decoded.prefix), signingBytes));
  const signature = bech32.fromWords(decoded.words.slice(-104));
  if (signature[64] > 3) throw new Error('invalid-invoice');
  const recovered = secp256k1.recoverPublicKey(concatBytes(signature.slice(64), signature.slice(0, 64)), digest, { prehash: false });
  if (payee && bytesToHex(payee) !== bytesToHex(recovered)
    || !secp256k1.verify(signature.slice(0, 64), digest, recovered, { prehash: false, lowS: false })) throw new Error('invalid-invoice');
  return { invoice, amountMsat: Number(msat), paymentHash: hash, expiresAt, description: description?.slice(0, 1000) ?? '' };
}
