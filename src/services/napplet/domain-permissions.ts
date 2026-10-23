import { NAP_DOMAINS, type NappletRelease } from './protocol';
import { getData, type AppScope } from './repository';

const DEFAULT_OPTIONAL_DOMAINS = ['theme', 'storage', 'config'] as const;

/** Defaults apply only to declared optional capabilities, below explicit denials. */
export function resolveDomainPermissions(
  release: Pick<NappletRelease, 'required' | 'optional'>,
  granted: readonly string[],
  denied: readonly string[],
): string[] {
  const required = new Set(['shell', ...release.required]);
  const optional = new Set(release.optional.filter(domain =>
    (NAP_DOMAINS as readonly string[]).includes(domain) && !required.has(domain)));
  const blocked = new Set(denied);
  return [...new Set([
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
