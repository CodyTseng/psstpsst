/** These declarations expose APIs; sensitive operations use signer authorization. */
export function isImplicitNappletDomain(domain: string): boolean {
  return domain === 'identity' || domain === 'common';
}

export function nappletAccessDomains(domains: readonly string[]): string[] {
  return domains.filter(domain => !isImplicitNappletDomain(domain));
}
