import { DEFAULT_NOSTR_EVENT_URL } from '@/lib/nostr/event-url';
import { getDevicePreference, trySetDevicePreference } from '@/services/preferences/device-preferences.service';
import { useChatPrefsStore } from '../chat-prefs.store';

jest.mock('@/services/preferences/device-preferences.service', () => ({
  getDevicePreference: jest.fn(),
  trySetDevicePreference: jest.fn(async () => {}),
}));

beforeEach(() => {
  jest.clearAllMocks();
  useChatPrefsStore.setState({ enterToSend: false, nostrEventUrl: DEFAULT_NOSTR_EVENT_URL });
});

it('persists the note URL and restores it alongside the composer preference', async () => {
  useChatPrefsStore.getState().setNostrEventUrl(' https://example.com/notes/{id} ');
  expect(trySetDevicePreference).toHaveBeenCalledWith('chat.nostrEventUrl', 'https://example.com/notes/{id}');
  useChatPrefsStore.setState({ nostrEventUrl: DEFAULT_NOSTR_EVENT_URL });
  jest.mocked(getDevicePreference).mockImplementation(async (key) => (
    key === 'chat.enterToSend' ? 'true' : 'https://example.com/notes/{id}'
  ));
  await useChatPrefsStore.getState().load();
  expect(useChatPrefsStore.getState()).toMatchObject({
    enterToSend: true,
    nostrEventUrl: 'https://example.com/notes/{id}',
  });
});

it.each([null, '', 'javascript:alert(1)', 'https://'])('uses Jumble for missing or invalid saved URLs: %s', async (value) => {
  jest.mocked(getDevicePreference).mockResolvedValue(value);
  await useChatPrefsStore.getState().load();
  expect(useChatPrefsStore.getState().nostrEventUrl).toBe(DEFAULT_NOSTR_EVENT_URL);
});

it.each(['nostr:{id}', 'myapp://{id}', 'myapp://open?note={id}'])('persists and restores an app URL: %s', async (value) => {
  useChatPrefsStore.getState().setNostrEventUrl(value);
  expect(trySetDevicePreference).toHaveBeenCalledWith('chat.nostrEventUrl', value);
  useChatPrefsStore.setState({ nostrEventUrl: DEFAULT_NOSTR_EVENT_URL });
  jest.mocked(getDevicePreference).mockImplementation(async (key) => (
    key === 'chat.nostrEventUrl' ? value : null
  ));
  await useChatPrefsStore.getState().load();
  expect(useChatPrefsStore.getState().nostrEventUrl).toBe(value);
});

it('keeps the existing preference on invalid input and lets blank input restore Jumble', () => {
  useChatPrefsStore.getState().setNostrEventUrl('https://example.com/{id}');
  useChatPrefsStore.getState().setNostrEventUrl('file:///tmp/{id}');
  expect(useChatPrefsStore.getState().nostrEventUrl).toBe('https://example.com/{id}');
  expect(trySetDevicePreference).toHaveBeenCalledTimes(1);
  useChatPrefsStore.getState().setNostrEventUrl('');
  expect(useChatPrefsStore.getState().nostrEventUrl).toBe(DEFAULT_NOSTR_EVENT_URL);
  expect(trySetDevicePreference).toHaveBeenLastCalledWith('chat.nostrEventUrl', DEFAULT_NOSTR_EVENT_URL);
});

it('keeps defaults without rejecting when preference storage is unavailable', async () => {
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  jest.mocked(getDevicePreference).mockRejectedValue(new Error('storage unavailable'));

  await expect(useChatPrefsStore.getState().load()).resolves.toBeUndefined();

  expect(useChatPrefsStore.getState()).toMatchObject({
    enterToSend: false,
    nostrEventUrl: DEFAULT_NOSTR_EVENT_URL,
  });
  jest.restoreAllMocks();
});
