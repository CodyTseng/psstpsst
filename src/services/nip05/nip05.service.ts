import { base64 } from '@scure/base';

import { NIP05_SERVICE_BASE_URL, NIP05_SERVICE_DOMAIN } from '@/lib/nostr/nip05';

import type { Signer } from '../signer/signer.interface';

/**
 * Client for the app's own NIP-05 naming service (`psstpsst.chat`). Names are
 * claimed and renamed with NIP-98 (kind 27235) authorization events signed by
 * the account key; the bound pubkey always equals the event signer, so a name
 * can never be claimed for someone else's key. Lookup is the public
 * `/.well-known/nostr.json` endpoint. See docs/protocols/nip05-registration.md.
 */

/** 5-30 chars using lowercase ASCII name characters, with alphanumeric ends. */
const NAME_RE = /^[a-z0-9][a-z0-9._-]{3,28}[a-z0-9]$/;
/** Legacy registrations may predate the current length and trailing-character rules. */
const EXISTING_NAME_RE = /^[a-z0-9][a-z0-9._-]{0,62}$/;
const HEX_PUBKEY_RE = /^[0-9a-f]{64}$/;
const REQUEST_TIMEOUT_MS = 12_000;
const KIND_HTTP_AUTH = 27235;

export type Nip05NameErrorCode =
  | 'invalid_name'
  | 'name_reserved'
  | 'name_taken'
  | 'not_found'
  | 'auth_failed'
  | 'request_failed';

export class Nip05NameError extends Error {
  constructor(readonly code: Nip05NameErrorCode) {
    super(code);
    this.name = 'Nip05NameError';
  }
}

export type Nip05NameAvailability = 'available' | 'invalid' | 'reserved' | 'taken';

/** Normalize (trim + lowercase) and validate a candidate local part. */
export function normalizeNip05Name(input: string): string | null {
  const name = input.trim().toLowerCase();
  return NAME_RE.test(name) ? name : null;
}

/** Normalize a trusted lookup result without rejecting legacy short names. */
function normalizeExistingNip05Name(input: string): string | null {
  const name = input.trim().toLowerCase();
  return EXISTING_NAME_RE.test(name) ? name : null;
}

export function nip05IdentifierForName(name: string): string {
  return `${name}@${NIP05_SERVICE_DOMAIN}`;
}

/** `fetch` with an abort-based timeout (RN `fetch` has none of its own). */
async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  ms: number,
): Promise<Response> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, { ...init, signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
}

/** Sign a NIP-98 kind-27235 auth event for one exact request URL + method. */
async function buildNip98AuthHeader(
  signer: Signer,
  url: string,
  method: string,
): Promise<string> {
  const event = await signer.signEvent({
    kind: KIND_HTTP_AUTH,
    content: '',
    created_at: Math.floor(Date.now() / 1000),
    tags: [
      ['u', url],
      ['method', method],
    ],
  });
  return `Nostr ${base64.encode(new TextEncoder().encode(JSON.stringify(event)))}`;
}

/** Check whether a candidate name can be claimed without fetching its binding. */
export async function checkNip05NameAvailability(
  name: string,
): Promise<Nip05NameAvailability> {
  let res: Response;
  try {
    res = await fetchWithTimeout(
      `${NIP05_SERVICE_BASE_URL}/api/names/${encodeURIComponent(name)}/availability`,
      { method: 'GET' },
      REQUEST_TIMEOUT_MS,
    );
  } catch {
    throw new Nip05NameError('request_failed');
  }

  if (res.status === 200) return 'available';
  if (res.status === 400) return 'invalid';
  if (res.status === 403) return 'reserved';
  if (res.status === 409) return 'taken';
  throw new Nip05NameError('request_failed');
}

/**
 * Resolve a local part on the naming service. Returns the bound pubkey, or
 * null when the name is unregistered. Network and malformed-response failures
 * throw so the UI can distinguish "couldn't check" from "available".
 */
export async function lookupNip05Name(name: string): Promise<string | null> {
  let res: Response;
  try {
    res = await fetchWithTimeout(
      `${NIP05_SERVICE_BASE_URL}/.well-known/nostr.json?name=${encodeURIComponent(name)}`,
      { method: 'GET' },
      REQUEST_TIMEOUT_MS,
    );
  } catch {
    throw new Nip05NameError('request_failed');
  }
  if (!res.ok) throw new Nip05NameError('request_failed');
  try {
    const json = (await res.json()) as { names?: Record<string, unknown> };
    const pubkey = json.names?.[name];
    return typeof pubkey === 'string' && HEX_PUBKEY_RE.test(pubkey.toLowerCase())
      ? pubkey.toLowerCase()
      : null;
  } catch {
    throw new Nip05NameError('request_failed');
  }
}

/**
 * Reverse lookup: the name already claimed by a pubkey, or null when the key
 * owns none. The service allows one name per pubkey, so the profile flow uses
 * this to switch already-claimed users from "register" to "update". Network
 * and malformed-response failures throw; callers treat that as "unknown".
 */
export async function lookupNip05NameByPubkey(pubkey: string): Promise<string | null> {
  let res: Response;
  try {
    res = await fetchWithTimeout(
      `${NIP05_SERVICE_BASE_URL}/.well-known/nostr.json?pubkey=${encodeURIComponent(pubkey)}`,
      { method: 'GET' },
      REQUEST_TIMEOUT_MS,
    );
  } catch {
    throw new Nip05NameError('request_failed');
  }
  if (!res.ok) throw new Nip05NameError('request_failed');
  try {
    // Same shape as the forward lookup: a NIP-05 names object, here holding
    // the single name this key owns.
    const json = (await res.json()) as { names?: Record<string, unknown> };
    const names = json.names;
    if (!names || typeof names !== 'object') return null;
    for (const [name, bound] of Object.entries(names)) {
      if (typeof bound !== 'string' || bound.toLowerCase() !== pubkey.toLowerCase()) {
        continue;
      }
      return normalizeExistingNip05Name(name) ?? null;
    }
    return null;
  } catch {
    throw new Nip05NameError('request_failed');
  }
}

function errorForStatus(
  status: number,
  forbiddenCode: Extract<Nip05NameErrorCode, 'auth_failed' | 'name_reserved'> = 'auth_failed',
): Nip05NameError {
  if (status === 400) return new Nip05NameError('invalid_name');
  if (status === 401) return new Nip05NameError('auth_failed');
  if (status === 403) return new Nip05NameError(forbiddenCode);
  if (status === 404) return new Nip05NameError('not_found');
  if (status === 409) return new Nip05NameError('name_taken');
  return new Nip05NameError('request_failed');
}

/**
 * Claim or rename with a bodyless PUT. The server binds the name to the
 * NIP-98 signer and releases any previous name owned by that key. Repeating
 * the request for an already-owned name succeeds without changing the binding.
 */
export async function upsertNip05Name(opts: {
  signer: Signer;
  name: string;
}): Promise<{ name: string; pubkey: string }> {
  const name = normalizeNip05Name(opts.name);
  if (!name) throw new Nip05NameError('invalid_name');

  const url = `${NIP05_SERVICE_BASE_URL}/api/names/${encodeURIComponent(name)}`;
  const pubkey = await opts.signer.getPublicKey();
  let res: Response;
  try {
    res = await fetchWithTimeout(
      url,
      {
        method: 'PUT',
        headers: {
          Authorization: await buildNip98AuthHeader(opts.signer, url, 'PUT'),
        },
      },
      REQUEST_TIMEOUT_MS,
    );
  } catch {
    throw new Nip05NameError('request_failed');
  }
  if (res.status !== 200 && res.status !== 201) {
    throw errorForStatus(res.status, 'name_reserved');
  }
  return { name, pubkey };
}

/**
 * Release a name the signer's key currently owns (DELETE /api/names/:name).
 * Must be signed with the currently bound key.
 */
export async function deleteNip05Name(opts: {
  signer: Signer;
  name: string;
}): Promise<void> {
  const name = normalizeNip05Name(opts.name);
  if (!name) throw new Nip05NameError('invalid_name');

  const url = `${NIP05_SERVICE_BASE_URL}/api/names/${encodeURIComponent(name)}`;
  let res: Response;
  try {
    res = await fetchWithTimeout(
      url,
      {
        method: 'DELETE',
        headers: {
          Authorization: await buildNip98AuthHeader(opts.signer, url, 'DELETE'),
        },
      },
      REQUEST_TIMEOUT_MS,
    );
  } catch {
    throw new Nip05NameError('request_failed');
  }
  if (res.status !== 200) throw errorForStatus(res.status);
}
