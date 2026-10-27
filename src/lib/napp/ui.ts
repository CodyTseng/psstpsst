import * as kit from './vendor/ui';
import { nappUiStyles } from './ui-styles.generated';

/** Runs only inside the application's document, never in host approval chrome. */
export function installNappUi(napp: any) {
  let fonts: Promise<void> | undefined;
  napp.ui = { ...kit, fonts: () => fonts ??= Promise.resolve(document.fonts?.ready).then(() => {}) };
  const style = document.createElement('style');
  style.dataset.nappUi = '08a7f6f';
  style.textContent = nappUiStyles;
  const attach = () => {
    if (!document.head) return false;
    document.head.insertBefore(style, document.head.firstChild);
    return true;
  };
  if (!attach()) {
    const observer = new MutationObserver(() => { if (attach()) observer.disconnect(); });
    observer.observe(document, { childList: true, subtree: true });
    addEventListener('pagehide', () => observer.disconnect(), { once: true });
  }
  kit.authors.use({
    load: pubkey => napp.utils.loadNostrUser(pubkey),
    npub: pubkey => napp.nip19.npubEncode(pubkey),
    open: pubkey => { void napp.action('profile', pubkey).catch(() => {}); },
    search: (term, options) => napp.utils.findAuthors(term, options),
  });
}
