import { openMessageUrl } from '../open-message-url';
import { platform } from '@/platform';
import { useActiveAccount } from '@/stores/active-account.store';
import { showToast } from '@/stores/toast.store';
import { websiteEntry } from '@/services/explore/model';
import { tryOpenApplicationWindow } from '@/services/explore/windows';
import { openInlineApplication } from '@/services/explore/inline-launch';

jest.mock('@/i18n/core', () => ({ __esModule: true, default: { t: (key: string) => key } }));
jest.mock('@/platform', () => ({ platform: { urlOpener: { openExternalUrl: jest.fn(async () => true) } } }));
jest.mock('@/stores/active-account.store', () => ({ useActiveAccount: { getState: jest.fn() } }));
jest.mock('@/stores/toast.store', () => ({ showToast: jest.fn() }));
jest.mock('@/services/explore/model', () => ({ websiteEntry: jest.fn((address: string) => ({ kind: 'website', address })) }));
jest.mock('@/services/explore/windows', () => ({ tryOpenApplicationWindow: jest.fn() }));
jest.mock('@/services/explore/inline-launch', () => ({ openInlineApplication: jest.fn() }));

beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(useActiveAccount.getState).mockReturnValue({ activePubkey: 'account', status: 'ready' } as never);
  jest.mocked(tryOpenApplicationWindow).mockResolvedValue(false);
  jest.mocked(openInlineApplication).mockResolvedValue(undefined);
});

it.each(['https://example.com/path?q=1#section', 'http://example.com/', 'https://jumble.social/note1example'])(
  'opens %s through the inline website host', async href => {
    await openMessageUrl(href);
    expect(websiteEntry).toHaveBeenCalledWith(href);
    expect(tryOpenApplicationWindow).toHaveBeenCalledWith({ kind: 'website', address: href }, 'account');
    expect(openInlineApplication).toHaveBeenCalledWith({ entry: { kind: 'website', address: href }, account: 'account' });
    expect(platform.urlOpener.openExternalUrl).not.toHaveBeenCalled();
  },
);

it('respects an independent website window preference', async () => {
  jest.mocked(tryOpenApplicationWindow).mockResolvedValue(true);
  await openMessageUrl('https://example.com/');
  expect(openInlineApplication).not.toHaveBeenCalled();
  expect(platform.urlOpener.openExternalUrl).not.toHaveBeenCalled();
});

it('retains a configured custom note application protocol', async () => {
  await openMessageUrl('nostr:note1example');
  expect(platform.urlOpener.openExternalUrl).toHaveBeenCalledWith('nostr:note1example');
  expect(tryOpenApplicationWindow).not.toHaveBeenCalled();
});

it('cancels a delayed launch when the account changes', async () => {
  jest.mocked(useActiveAccount.getState)
    .mockReturnValueOnce({ activePubkey: 'account', status: 'ready' } as never)
    .mockReturnValueOnce({ activePubkey: 'other', status: 'ready' } as never);
  await openMessageUrl('https://example.com/');
  expect(openInlineApplication).not.toHaveBeenCalled();
});

it('reports launch failures without opening an external browser', async () => {
  const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
  jest.mocked(tryOpenApplicationWindow).mockRejectedValueOnce(new Error('launch-failed'));
  try {
    await openMessageUrl('https://example.com/');
    expect(showToast).toHaveBeenCalledWith('applications.request_failed', { variant: 'error' });
    expect(platform.urlOpener.openExternalUrl).not.toHaveBeenCalled();
  } finally {
    warn.mockRestore();
  }
});
