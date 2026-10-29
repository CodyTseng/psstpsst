import { nappletAccessDomains } from '@/services/napplet/access-domains';
import { NAP_DOMAINS, type NappletRelease } from './protocol';
import { getData, type AppScope } from './repository';

const DEFAULT_OPTIONAL_DOMAINS = ['theme', 'storage', 'config'] as const;

/** Shell is implicit; optional defaults apply only when declared and not denied. */
export function resolveDomainPermissions(
  release: Pick<NappletRelease, 'required' | 'optional'>,
  granted: readonly string[],
  denied: readonly string[],
): string[] {
  const required = new Set(['shell', ...nappletAccessDomains(release.required)]);
  const optional = new Set(nappletAccessDomains(release.optional).filter(domain =>
    (NAP_DOMAINS as readonly string[]).includes(domain) && !required.has(domain)));
  const blocked = new Set(denied);
  return [...new Set([
    'shell',
    ...granted.filter(domain => required.has(domain) || optional.has(domain) && !blocked.has(domain)),
    ...DEFAULT_OPTIONAL_DOMAINS.filter(domain => optional.has(domain) && !blocked.has(domain)),
  ])];
}

function parseDomains(raw: string | null): string[] {
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
  const [saved, storedDenied] = await Promise.all([
    getData(scope, 'permissions', 'domains'), getData(scope, 'permissions', 'denied-domains'),
  ]);
  const denied = parseDomains(storedDenied);
  return { saved: !!saved, denied,
    domains: resolveDomainPermissions(release, saved ? parseDomains(saved) : fallback, denied) };
}
