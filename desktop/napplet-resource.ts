import { request } from 'node:https';
import { isIP } from 'node:net';
import { isPublicAddress, resolvePublicAddresses } from './napplet-public-dns';
import type { ResourceResponse, ResourceValidators } from '../src/platform/ports/napplet';

/** Redirects share one deadline; every hop validates its URL, DNS and TLS independently. */
export async function fetchNappletResource(value: string, maxBytes: number, signal?: AbortSignal, accept = '*/*'): Promise<Uint8Array> {
  if (!['*/*', 'application/json', 'application/nostr+json'].includes(accept)) throw new Error('invalid-accept');
  const deadline = AbortSignal.timeout(20000);
  return (await fetchPublicResource(value, maxBytes, signal ? AbortSignal.any([signal, deadline]) : deadline, 0, accept)).bytes;
}

export function fetchNappletResourceResponse(value: string, maxBytes: number, signal?: AbortSignal, validators?: ResourceValidators): Promise<ResourceResponse> {
  for (const header of [validators?.etag, validators?.lastModified]) {
    if (header !== undefined && (typeof header !== 'string' || header.length > 2048 || /[\r\n\0]/.test(header))) throw new Error('invalid-validator');
  }
  const deadline = AbortSignal.timeout(20000);
  return fetchPublicResource(value, maxBytes, signal ? AbortSignal.any([signal, deadline]) : deadline, 0, '*/*', validators);
}

/** DNS validation is part of the actual TLS connection, not a check-then-fetch preflight. */
function fetchPublicResource(
  value: string,
  maxBytes: number,
  signal: AbortSignal,
  redirects: number,
  accept: string,
  validators?: ResourceValidators,
): Promise<ResourceResponse> {
  const url = new URL(value);
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (
    (isIP(host) && !isPublicAddress(host)) ||
    value.length > 4096 ||
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    (url.port && url.port !== '443') ||
    !Number.isSafeInteger(maxBytes) ||
    maxBytes < 1 ||
    maxBytes > 25 * 1024 * 1024
  )
    return Promise.reject(new Error('blocked-by-policy'));
  return new Promise((resolve, reject) => {
    const req = request(
      url,
      {
        method: 'GET',
        agent: false,
        signal,
        headers: { Accept: accept, 'Accept-Encoding': 'identity',
          ...(validators?.etag ? { 'If-None-Match': validators.etag } : {}),
          ...(validators?.lastModified ? { 'If-Modified-Since': validators.lastModified } : {}) },
        lookup: (hostname, options, callback) => {
          void resolvePublicAddresses(hostname, signal).then((resolved) => {
            const addresses = options.family ? resolved.filter((entry) => entry.family === options.family) : resolved;
            if (!addresses.length) return callback(new Error('blocked-by-policy'), '', 4);
            if (options.all) callback(null, addresses);
            else callback(null, addresses[0].address, addresses[0].family);
          }, (error: Error) => callback(error, '', 4));
        },
      },
      (response) => {
        const headers = {
          ...(typeof response.headers.etag === 'string' ? { etag: response.headers.etag } : {}),
          ...(typeof response.headers['last-modified'] === 'string' ? { lastModified: response.headers['last-modified'] } : {}),
        };
        if (response.statusCode === 304 && (validators?.etag || validators?.lastModified)) {
          response.destroy(); resolve({ status: 304, bytes: new Uint8Array(), ...headers }); return;
        }
        if ([301, 302, 303, 307, 308].includes(response.statusCode ?? 0)) {
          const location = response.headers.location;
          response.destroy();
          if (!location || redirects >= 5) {
            reject(new Error(location ? 'redirect-limit' : 'resource-unavailable'));
            return;
          }
          try {
            resolve(fetchPublicResource(new URL(location, url).href, maxBytes, signal, redirects + 1, accept));
          } catch (error) { reject(error); }
          return;
        }
        if (
          response.statusCode !== 200 ||
          Number(response.headers['content-length']) > maxBytes ||
          (response.headers['content-encoding'] &&
            response.headers['content-encoding'] !== 'identity')
        ) {
          response.destroy();
          reject(new Error('resource-unavailable'));
          return;
        }
        const chunks: Buffer[] = [];
        let length = 0;
        response.on('data', (chunk: Buffer) => {
          length += chunk.length;
          if (length > maxBytes) response.destroy(new Error('too-large'));
          else chunks.push(chunk);
        });
        response.on('end', () => resolve({ status: 200, bytes: new Uint8Array(Buffer.concat(chunks, length)), ...headers }));
        response.on('error', reject);
      },
    );
    req.setTimeout(20000, () => req.destroy(new Error('timeout')));
    req.on('error', reject);
    req.end();
  });
}

