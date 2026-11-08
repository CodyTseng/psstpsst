import type { AppAuthorizationLevel } from '@/services/app-authorization/model';
import { readAppAuthorizationLevel } from '@/services/signing/repository';
import { normalizeSigningSource } from '@/services/signing/source';
import { automaticallyAllowsAccess } from '@/services/app-authorization/policy';

import { nappletAccessDomains } from '@/services/napplet/access-domains';
import { NAP_DOMAINS, type NappletRelease } from './protocol';
import { getData, type AppScope } from './repository';

const DEFAULT_OPTIONAL_DOMAINS = ['theme', 'storage', 'config'] as const;

/** Shell is implicit; optional defaults apply only when declared and not denied. */
export function resolveDomainPermissions(
  release: Pick<NappletRelease, 'required' | 'optional'>,
  granted: readonly string[],
  denied: readonly string[],
  level?: AppAuthorizationLevel,
): string[] {
  const required = new Set(['shell', ...nappletAccessDomains(release.required)]);
  const optional = new Set(nappletAccessDomains(release.optional).filter(domain =>
    (NAP_DOMAINS as readonly string[]).includes(domain) && !required.has(domain)));
  const blocked = new Set(denied);
  return [...new Set([
    'shell',
    ...[...required, ...optional].filter(domain => automaticallyAllowsAccess(level, domain)),
    ...granted.filter(domain => required.has(domain) || optional.has(domain) && !blocked.has(domain)),
    ...DEFAULT_OPTIONAL_DOMAINS.filter(domain => optional.has(domain) && !blocked.has(domain)),
  ])];
}

export function parseDomainPermissions(raw: string | null): string[] {
  const value: unknown = raw ? JSON.parse(raw) : [];
  if (!Array.isArray(value) || value.some(domain => typeof domain !== 'string')) throw new Error('invalid-permissions');
  return value;
}

/** Keep launch, runtime authorization and management on the same effective state. */
export async function readDomainPermissions(
  scope: AppScope,
  release: Pick<NappletRelease, 'required' | 'optional'>,
  fallback: readonly string[] = [],
) {
  const [saved, storedDenied, level] = await Promise.all([
    getData(scope, 'permissions', 'domains'), getData(scope, 'permissions', 'denied-domains'),
    readAppAuthorizationLevel({ accountPubkey: scope.accountPubkey, sourceId: normalizeSigningSource(scope.appKey) }),
  ]);
  const denied = parseDomainPermissions(storedDenied);
  const granted = saved ? parseDomainPermissions(saved) : [];
  return { saved: !!saved, denied, level, granted,
    domains: resolveDomainPermissions(release, saved ? granted : fallback, denied, level) };
}
