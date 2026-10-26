import { lookup } from 'node:dns/promises';
import type { LookupAddress } from 'node:dns';
import { request } from 'node:https';
import { isIP } from 'node:net';

export function isPublicAddress(address: string): boolean {
  const value = address.toLowerCase();
  if (value.includes(':')) return /^2[0-9a-f]{3}:/.test(value) && !value.startsWith('2001:db8:');
  const parts = value.split('.').map(Number);
  if (parts.length !== 4 || parts.some((v) => !Number.isInteger(v) || v < 0 || v > 255))
    return false;
  const [a, b] = parts;
  return !(
    a === 0 ||
    a === 10 ||
    a === 127 ||
    a >= 224 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && [0, 168].includes(b)) ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 198 && [18, 19, 51].includes(b)) ||
    (a === 203 && b === 0)
  );
}

type Resolver = { endpoint: string; bootstrap: string[] };
type Answer = { addresses: LookupAddress[]; ttl: number };
const resolvers: Resolver[] = [
  { endpoint: 'https://cloudflare-dns.com/dns-query', bootstrap: ['1.1.1.1', '1.0.0.1'] },
  { endpoint: 'https://dns.google/resolve', bootstrap: ['8.8.8.8', '8.8.4.4'] },
];
const MAX_DNS_BYTES = 32 * 1024;

/** Bounded DNS JSON over pinned public bootstrap addresses, with normal hostname TLS. */
async function queryPublicDns(hostname: string, resolver: Resolver, signal?: AbortSignal): Promise<Answer> {
  const url = new URL(resolver.endpoint);
  url.searchParams.set('name', hostname);
  url.searchParams.set('type', 'A');
  const bytes = await new Promise<Buffer>((resolve, reject) => {
    const req = request(url, {
      agent: false, signal, headers: { Accept: 'application/dns-json', 'Accept-Encoding': 'identity' },
      lookup: (host, options, callback) => {
        if (host !== url.hostname) return callback(new Error('blocked-by-policy'), '', 4);
        const addresses = resolver.bootstrap.map((address) => ({ address, family: 4 }));
        if (options.all) callback(null, addresses);
        else callback(null, addresses[0].address, 4);
      },
    }, (response) => {
      if (response.statusCode !== 200 || Number(response.headers['content-length']) > MAX_DNS_BYTES ||
          (response.headers['content-encoding'] && response.headers['content-encoding'] !== 'identity')) {
        response.destroy(); reject(new Error('dns-unavailable')); return;
      }
      const chunks: Buffer[] = [];
      let size = 0;
      response.on('data', (chunk: Buffer) => {
        size += chunk.length;
        if (size > MAX_DNS_BYTES) response.destroy(new Error('dns-response-too-large'));
        else chunks.push(chunk);
      });
      response.on('end', () => resolve(Buffer.concat(chunks, size)));
      response.on('error', reject);
    });
    const timer = setTimeout(() => req.destroy(new Error('dns-timeout')), 5000);
    req.once('close', () => clearTimeout(timer));
    req.on('error', reject);
    req.end();
  });
  const json: unknown = JSON.parse(bytes.toString('utf8'));
  if (!json || typeof json !== 'object' || !('Status' in json) || json.Status !== 0 ||
      ('TC' in json && json.TC) || !('Answer' in json) || !Array.isArray(json.Answer) || json.Answer.length > 64) {
    throw new Error('dns-unavailable');
  }
  const unique = new Map<string, LookupAddress>();
  let ttl = 60;
  for (const record of json.Answer) {
    if (!record || record.type !== 1) continue;
    if (typeof record.data !== 'string' || isIP(record.data) !== 4 || !isPublicAddress(record.data)) {
      throw new Error('blocked-by-policy');
    }
    unique.set(record.data, { address: record.data, family: 4 });
    ttl = Math.min(ttl, typeof record.TTL === 'number' && Number.isFinite(record.TTL) ? Math.max(0, record.TTL) : 0);
  }
  if (!unique.size) throw new Error('dns-unavailable');
  return { addresses: [...unique.values()], ttl };
}

/** Fake-IP answers are replaced by independently resolved public IPs, never admitted directly. */
export function createPublicDnsResolver({
  system = (hostname: string): Promise<LookupAddress[]> => lookup(hostname, { all: true }),
  query = queryPublicDns,
  now = Date.now,
} = {}) {
  const cache = new Map<string, Answer & { expires: number }>();
  return async (hostname: string, signal?: AbortSignal): Promise<LookupAddress[]> => {
    signal?.throwIfAborted();
    if (isIP(hostname)) {
      if (!isPublicAddress(hostname)) throw new Error('blocked-by-policy');
      return [{ address: hostname, family: isIP(hostname) }];
    }
    const cached = cache.get(hostname);
    if (cached && cached.expires > now()) return cached.addresses;
    cache.delete(hostname);
    let systemAddresses: LookupAddress[] = [];
    try { systemAddresses = await system(hostname); }
    catch { signal?.throwIfAborted(); }
    signal?.throwIfAborted();
    if (systemAddresses.length && systemAddresses.every((entry) => isPublicAddress(entry.address))) return systemAddresses;
    for (const resolver of resolvers) {
      try {
        const answer = await query(hostname, resolver, signal);
        signal?.throwIfAborted();
        if (!answer.addresses.length || !answer.addresses.every((entry) => isPublicAddress(entry.address))) continue;
        const ttl = Number.isFinite(answer.ttl) ? Math.min(60, Math.max(0, answer.ttl)) : 0;
        if (ttl > 0) {
          if (cache.size >= 64) cache.delete(cache.keys().next().value!);
          cache.set(hostname, { ...answer, expires: now() + ttl * 1000 });
        }
        return answer.addresses;
      } catch { signal?.throwIfAborted(); }
    }
    throw new Error('blocked-by-policy');
  };
}

export const resolvePublicAddresses = createPublicDnsResolver();
