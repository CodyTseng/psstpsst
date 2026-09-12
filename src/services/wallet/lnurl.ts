import { bech32 } from '@scure/base';

import { parseBolt11Invoice, type ParsedInvoice } from './bolt11';

const BECH32_LIMIT = 5000;
const MAX_SENDABLE_SATS = 1_000_000_000;
const REQUEST_TIMEOUT_MS = 12000;

export type LnurlPayRequest = {
  target: string;
  endpoint: string;
  callback: string;
  minSendableMsat: number;
  maxSendableMsat: number;
  metadata: string;
  description: string | null;
  domain: string | null;
  commentAllowed: number;
};

type LnurlPayResponse = {
  status?: string;
  reason?: string;
  tag?: string;
  callback?: string;
  metadata?: string;
  minSendable?: number | string;
  maxSendable?: number | string;
  commentAllowed?: number;
};

type LnurlInvoiceResponse = {
  status?: string;
  reason?: string;
  pr?: string;
};

export class LnurlError extends Error {
  constructor(
    readonly kind:
      | 'invalid_target'
      | 'unsupported'
      | 'network'
      | 'invalid_response'
      | 'invalid_amount'
      | 'invoice_failed',
    message?: string,
  ) {
    super(message ?? kind);
  }
}

export function isLikelyLnurlPayTarget(input: string): boolean {
  const target = normalizeLightningInput(input);
  return isLightningAddress(target) || /^lnurl1/i.test(target) || /^lnurlp:\/\//i.test(target) || /^https?:\/\//i.test(target);
}

export async function resolveLnurlPayTarget(input: string): Promise<LnurlPayRequest> {
  const target = normalizeLightningInput(input);
  const endpoint = lnurlPayEndpoint(target);
  const res = await fetchJson<LnurlPayResponse>(endpoint);
  if (res.status?.toUpperCase() === 'ERROR') throw new LnurlError('invalid_response', res.reason);
  if (res.tag !== 'payRequest' || !res.callback || !res.metadata) throw new LnurlError('unsupported');

  const callback = parseHttpsUrl(res.callback);
  const minSendableMsat = parsePositiveNumber(res.minSendable);
  const maxSendableMsat = parsePositiveNumber(res.maxSendable);
  if (minSendableMsat == null || maxSendableMsat == null || minSendableMsat > maxSendableMsat) {
    throw new LnurlError('invalid_response');
  }
  const cappedMaxSendableMsat = Math.min(maxSendableMsat, MAX_SENDABLE_SATS * 1000);
  if (minSendableMsat > cappedMaxSendableMsat) throw new LnurlError('invalid_response');

  return {
    target,
    endpoint,
    callback: callback.toString(),
    minSendableMsat,
    maxSendableMsat: cappedMaxSendableMsat,
    metadata: res.metadata,
    description: metadataText(res.metadata) ?? target,
    domain: callback.hostname,
    commentAllowed: Math.max(0, Math.floor(res.commentAllowed ?? 0)),
  };
}

export async function requestLnurlPayInvoice(
  request: LnurlPayRequest,
  amountSats: number,
  description?: string,
): Promise<ParsedInvoice> {
  if (!Number.isInteger(amountSats) || amountSats <= 0) throw new LnurlError('invalid_amount');
  const amountMsat = amountSats * 1000;
  if (amountMsat < request.minSendableMsat || amountMsat > request.maxSendableMsat) {
    throw new LnurlError('invalid_amount');
  }

  const callback = new URL(request.callback);
  callback.searchParams.set('amount', String(amountMsat));
  const comment = description?.trim();
  if (comment && request.commentAllowed > 0) {
    callback.searchParams.set('comment', comment.slice(0, request.commentAllowed));
  }
  const res = await fetchJson<LnurlInvoiceResponse>(callback.toString());
  if (res.status?.toUpperCase() === 'ERROR') throw new LnurlError('invoice_failed', res.reason);
  if (!res.pr) throw new LnurlError('invoice_failed');

  const parsed = parseBolt11Invoice(res.pr);
  if (parsed.amountMsat != null && parsed.amountMsat !== amountMsat) throw new LnurlError('invoice_failed');
  return parsed;
}

function lnurlPayEndpoint(target: string): string {
  if (isLightningAddress(target)) {
    const [name, domain] = target.split('@');
    return `https://${domain}/.well-known/lnurlp/${encodeURIComponent(name)}`;
  }
  if (/^lnurl1/i.test(target)) return decodeLnurl(target);
  if (/^lnurlp:\/\//i.test(target)) return lnurlpUriEndpoint(target);
  if (/^https?:\/\//i.test(target)) return parseHttpsUrl(target).toString();
  throw new LnurlError('invalid_target');
}

export function normalizeLightningInput(input: string): string {
  const trimmed = input.trim();
  const taggedParam = trimmed.match(/[?&](?:lightning|lnurl)=([^&#]+)/i)?.[1];
  let value = taggedParam ? safeDecodeURIComponent(taggedParam) : trimmed;
  value = value.replace(/^lightning:(?:\/\/)?/i, '').replace(/^lnurl:(?:\/\/)?/i, '').trim();
  if (/^lnurlp:/i.test(value) && !/^lnurlp:\/\//i.test(value)) {
    return value.replace(/^lnurlp:/i, '').trim();
  }
  return value;
}

function isLightningAddress(value: string): boolean {
  return /^[^\s@]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/.test(value);
}

function decodeLnurl(input: string): string {
  try {
    const decoded = bech32.decode(input.toLowerCase(), BECH32_LIMIT);
    if (decoded.prefix !== 'lnurl') throw new LnurlError('invalid_target');
    const bytes = bech32.fromWords(decoded.words);
    return parseHttpsUrl(utf8Decode(bytes)).toString();
  } catch (err) {
    if (err instanceof LnurlError) throw err;
    throw new LnurlError('invalid_target');
  }
}

function lnurlpUriEndpoint(input: string): string {
  try {
    const url = new URL(input);
    if (url.protocol !== 'lnurlp:' || !url.hostname) throw new LnurlError('invalid_target');
    if (url.username && !url.pathname) {
      return `https://${url.hostname}/.well-known/lnurlp/${encodeURIComponent(url.username)}`;
    }

    const path = url.pathname
      .split('/')
      .filter(Boolean)
      .map((part) => encodeURIComponent(safeDecodeURIComponent(part)))
      .join('/');
    if (!path) throw new LnurlError('invalid_target');

    const endpoint = new URL(`https://${url.hostname}/.well-known/lnurlp/${path}`);
    endpoint.search = url.search;
    return endpoint.toString();
  } catch (err) {
    if (err instanceof LnurlError) throw err;
    throw new LnurlError('invalid_target');
  }
}

function parseHttpsUrl(value: string): URL {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:') throw new LnurlError('invalid_target');
    return url;
  } catch (err) {
    if (err instanceof LnurlError) throw err;
    throw new LnurlError('invalid_target');
  }
}

async function fetchJson<T>(url: string): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(url, { headers: { accept: 'application/json' }, signal: controller.signal });
    if (!res.ok) throw new LnurlError('network');
    return (await res.json()) as T;
  } catch (err) {
    if (err instanceof LnurlError) throw err;
    throw new LnurlError('network');
  } finally {
    clearTimeout(timer);
  }
}

function parsePositiveNumber(value: number | string | undefined): number | null {
  const parsed = typeof value === 'string' ? Number(value) : value;
  if (!Number.isFinite(parsed) || parsed == null || parsed <= 0) return null;
  return Math.floor(parsed);
}

function metadataText(metadata: string): string | null {
  try {
    const entries = JSON.parse(metadata) as unknown;
    if (!Array.isArray(entries)) return null;
    const text =
      entries.find(
        (entry): entry is [string, string] =>
          Array.isArray(entry) && entry[0] === 'text/plain' && typeof entry[1] === 'string',
      ) ??
      entries.find(
        (entry): entry is [string, string] =>
          Array.isArray(entry) && entry[0] === 'text/identifier' && typeof entry[1] === 'string',
      );
    return text?.[1] || null;
  } catch {
    return null;
  }
}

function utf8Decode(bytes: Uint8Array): string {
  const encoded = Array.from(bytes, (b) => `%${b.toString(16).padStart(2, '0')}`).join('');
  try {
    return decodeURIComponent(encoded);
  } catch {
    throw new LnurlError('invalid_target');
  }
}

function safeDecodeURIComponent(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}
