import type { AppAuthorization } from './model';
import { isSignerAccess, type SigningScope } from '../signing/model';

export const EVERYDAY_ACCESS = ['shell', 'network', 'resource', 'storage', 'config', 'theme', 'ui', 'identity', 'common', 'relay', 'outbox'] as const;
/** Ordinary editable rules, materialized once after explicit first-use consent. */
export const EVERYDAY_SIGNING: readonly SigningScope[] = [
  ...(['get-public-key', 'nip04-encrypt', 'nip44-encrypt'] as const).map(operation => ({ operation, relays: [] })),
  { operation: 'relay-auth', kind: 22242, relays: [] },
  ...[1, 4, 6, 7, 13, 16, 1059].map(kind => ({ operation: 'publish' as const, kind, relays: [] })),
];

/** Full trust only covers known host operations, never independent device/payment reviews. */
export function automaticallyAllowsSigning(authorization: AppAuthorization | undefined, request: SigningScope): boolean {
  if (!authorization?.fullyTrusted) return false;
  return isSignerAccess(request) || ['relay-auth', 'http-auth', 'upload', 'sign', 'publish', 'encrypt-publish'].includes(request.operation);
}
export function automaticallyAllowsAccess(authorization: AppAuthorization | undefined, domain: string): boolean {
  return !!authorization?.fullyTrusted && ((EVERYDAY_ACCESS as readonly string[]).includes(domain) || domain === 'upload');
}
export function automaticallyAllowsWalletInfo(authorization: AppAuthorization | undefined): boolean {
  return !!authorization?.fullyTrusted;
}
