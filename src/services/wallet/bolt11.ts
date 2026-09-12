import { bech32 } from '@scure/base';

import { walletDescriptionText } from '@/lib/wallet/description';

const MSAT_PER_BTC = 100_000_000_000;
const BECH32_LIMIT = 5000;
const BOLT11_SIGNATURE_WORDS = 104;
const BECH32_CHARS = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l';

export type ParsedInvoice = {
  invoice: string;
  amountMsat: number | null;
  description: string | null;
  paymentHash: string | null;
  createdAt: number | null;
  expiresAt: number | null;
};

export function parseBolt11Invoice(input: string): ParsedInvoice {
  const invoice = input.trim().toLowerCase().replace(/^lightning:/, '');
  const match = invoice.match(/^ln(?:bc|tb|bcrt)(\d+[munp]?)?1[023456789acdefghjklmnpqrstuvwxyz]+$/i);
  if (!match) throw new Error('invalid_invoice');
  const amountMsat = match[1] ? decodeBolt11AmountMsat(match[1]) : null;
  const details = decodeBolt11Details(invoice);
  return { invoice, amountMsat, ...details };
}

function decodeBolt11AmountMsat(amount: string): number {
  const suffix = amount.match(/[munp]$/)?.[0];
  const digits = Number(suffix ? amount.slice(0, -1) : amount);
  if (!Number.isFinite(digits) || digits <= 0) throw new Error('invalid_invoice');

  switch (suffix) {
    case 'm':
      return digits * 100_000_000;
    case 'u':
      return digits * 100_000;
    case 'n':
      return digits * 100;
    case 'p':
      return Math.ceil(digits / 10);
    default:
      return digits * MSAT_PER_BTC;
  }
}

export function formatSats(msat: number | null | undefined, unit: string, unknown = 'Unknown'): string {
  if (msat == null) return unknown;
  const sats = msat / 1000;
  return `${formatNumber(sats)} ${unit}`;
}

export function formatNumber(value: number): string {
  if (!Number.isFinite(value)) return '0';
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: value < 1 ? 3 : 0 }).format(value);
}

function decodeBolt11Details(
  invoice: string,
): Pick<ParsedInvoice, 'description' | 'paymentHash' | 'createdAt' | 'expiresAt'> {
  try {
    const decoded = bech32.decode(invoice, BECH32_LIMIT);
    const words = decoded.words;
    if (words.length < 7 + BOLT11_SIGNATURE_WORDS) {
      return { description: null, paymentHash: null, createdAt: null, expiresAt: null };
    }

    const createdAt = wordsToInt(words.slice(0, 7));
    let description: string | null = null;
    let paymentHash: string | null = null;
    let expirySeconds: number | null = null;
    let offset = 7;
    const taggedEnd = words.length - BOLT11_SIGNATURE_WORDS;

    while (offset + 3 <= taggedEnd) {
      const tag = BECH32_CHARS[words[offset]];
      const length = words[offset + 1] * 32 + words[offset + 2];
      const start = offset + 3;
      const end = start + length;
      if (end > taggedEnd) break;
      const data = words.slice(start, end);
      if (tag === 'd') {
        description = walletDescriptionText(utf8Decode(bech32.fromWords(data)));
      } else if (tag === 'p') {
        paymentHash = bytesToHex(bech32.fromWords(data));
      } else if (tag === 'x') {
        expirySeconds = wordsToInt(data);
      }
      offset = end;
    }

    return {
      description,
      paymentHash,
      createdAt,
      expiresAt: expirySeconds != null ? createdAt + expirySeconds : null,
    };
  } catch {
    return { description: null, paymentHash: null, createdAt: null, expiresAt: null };
  }
}

function wordsToInt(words: number[]): number {
  return words.reduce((acc, word) => acc * 32 + word, 0);
}

function utf8Decode(bytes: Uint8Array): string {
  const encoded = Array.from(bytes, (b) => `%${b.toString(16).padStart(2, '0')}`).join('');
  try {
    return decodeURIComponent(encoded);
  } catch {
    return '';
  }
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}
