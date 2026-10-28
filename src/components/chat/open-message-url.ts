import i18n from '@/i18n/core';
import { platform } from '@/platform';
import { openInlineApplication } from '@/services/explore/inline-launch';
import { websiteEntry } from '@/services/explore/model';
import { tryOpenApplicationWindow } from '@/services/explore/windows';
import { useActiveAccount } from '@/stores/active-account.store';
import { showToast } from '@/stores/toast.store';

/** Reuse website launch preferences without subscribing message rows to account state. */
export async function openMessageUrl(href: string): Promise<void> {
  try {
    const url = new URL(href);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      if (!await platform.urlOpener.openExternalUrl(href)) throw new Error('external-open-failed');
      return;
    }
    const { activePubkey: account, status } = useActiveAccount.getState();
    if (!account || status !== 'ready') throw new Error('account-unavailable');
    const entry = websiteEntry(href);
    if (await tryOpenApplicationWindow(entry, account)) return;
    const active = useActiveAccount.getState();
    if (active.status !== 'ready' || active.activePubkey !== account) return;
    await openInlineApplication({ entry, account });
  } catch (error) {
    console.warn('[chat] Could not open message link', error);
    showToast(i18n.t('applications.request_failed'), { variant: 'error' });
  }
}
