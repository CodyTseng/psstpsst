import type { AppAuthorizationLevel } from '@/services/app-authorization/model';
import { isSignerAccess, type SigningScope } from '../signing/model';

/** Wallet metadata excludes balances, history and payment authority. */
export function automaticallyAllowsWalletInfo(level: AppAuthorizationLevel | undefined): boolean {
  return level === 'routine' || level === 'trusted';
}

// Routine uses explicit kinds; new host operations require a policy entry at every level.
const ROUTINE_KINDS = new Set([1, 4, 6, 7, 13, 16, 1059]);

/** This classifies authority, not an application's claimed intent or user gestures. */
export function automaticallyAllowsSigning(level: AppAuthorizationLevel | undefined, request: SigningScope): boolean {
  if (level === undefined || level === 'manual') return false;
  if (isSignerAccess(request)) return level === 'trusted' ||
    ['get-public-key', 'nip04-encrypt', 'nip44-encrypt'].includes(request.operation);
  if (request.operation === 'relay-auth') return true;
  if (request.operation === 'http-auth' || request.operation === 'upload') return level === 'trusted';
  if (!['sign', 'publish', 'encrypt-publish'].includes(request.operation)) return false;
  return level === 'trusted' || ROUTINE_KINDS.has(request.kind);
}

// These expose app-isolated storage, public transport or separately reviewed operations.
const ROUTINE_ACCESS = new Set(['shell', 'network', 'resource', 'storage', 'config', 'theme', 'ui', 'identity', 'common', 'relay', 'outbox']);
export function automaticallyAllowsAccess(level: AppAuthorizationLevel | undefined, domain: string): boolean {
  return (level === 'routine' || level === 'trusted') && (ROUTINE_ACCESS.has(domain) || level === 'trusted' && domain === 'upload');
}
