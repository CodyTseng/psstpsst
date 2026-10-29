/** Identity disclosure uses signer authorization instead of a domain grant. */
export function nappletAccessDomains(domains: readonly string[]): string[] {
  return domains.filter(domain => domain !== 'identity');
}
