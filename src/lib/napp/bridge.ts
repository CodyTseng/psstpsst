import { nappletPrelude } from './prelude.generated';
import { nappPureHelpers } from './pure-helpers.generated';
import { nappBootstrap } from './bootstrap.generated';

/** Shared document-start bridge. Only the platform transport assigns origin authority. */
export function exploreBridge(napp: boolean, theme?: {
  background: string;
  text: string;
  primary: string;
}, domains: readonly string[] = [], instance?: string): string {
  const shared = napp ? domains.filter(domain => domain === 'config' || domain === 'inc') : [];
  return `${nappBootstrap}\nPsstNappBootstrap.install(${JSON.stringify({ napp, theme, domains: shared, instance })});` +
    (shared.length ? `\n${nappletPrelude}\nNappletShimPrelude.install({domains:${JSON.stringify(shared)}});` : '') +
    (napp ? `\n${nappPureHelpers}\nPsstNappHelpers.install(window.napp);` : '');
}
