import { nip19 } from 'nostr-tools';

import { openExternalUrl } from '../external-url';

const identifier = nip19.noteEncode('ab'.repeat(32));
const open = jest.fn(async (_url: string) => {});
const readNostrEventUrl = jest.fn<Promise<string | null>, []>();
const dependencies = { open, readNostrEventUrl };

beforeEach(() => {
  jest.clearAllMocks();
  readNostrEventUrl.mockResolvedValue(null);
});

it.each(['https://example.com/', 'http://example.com/', 'nostrconnect://signer', 'bunker://signer'])(
  'opens existing supported links without querying preferences: %s', async (value) => {
    await openExternalUrl(value, dependencies);
    expect(open).toHaveBeenCalledWith(value);
    expect(readNostrEventUrl).not.toHaveBeenCalled();
  },
);

it.each([
  'nostr:{id}',
  'myapp://{id}',
  'myapp://note/{id}',
  'MyApp+notes.v2://open?event={id}',
  'myapp://open?event={id}&again={id}',
  'myapp://{id}suffix',
  'myapp://{id}/{id}2',
])('opens a link matching the saved app template exactly: %s', async (template) => {
  readNostrEventUrl.mockResolvedValue(template);
  const value = template.replaceAll('{id}', identifier);
  await openExternalUrl(value, dependencies);
  expect(open).toHaveBeenCalledWith(value);
});

it.each([
  [null, `myapp://${identifier}`],
  ['otherapp://{id}', `myapp://${identifier}`],
  ['myapp://note/{id}', `myapp://command/${identifier}`],
  ['myapp://{id}', `myapp://${identifier}?command=delete`],
  ['myapp://{id}', `myapp://${identifier}\n`],
  ['myapp://{id}', 'myapp://run-command'],
  ['myapp://{id}', `myapp://note1${'a'.repeat(5001)}`],
  ['myapp://{id}/{id}', `myapp://${identifier}/note1different`],
  ['myapp://open?event={id}', `myapp://openXevent=${identifier}`],
  ['file:///{id}', `file:///${identifier}`],
  ['javascript:{id}', `javascript:${identifier}`],
])('rejects a custom link outside the saved template (%s)', async (template, value) => {
  readNostrEventUrl.mockResolvedValue(template);
  await expect(openExternalUrl(value!, dependencies)).rejects.toThrow();
  expect(open).not.toHaveBeenCalled();
});

it('does not open a custom link when reading its saved configuration fails', async () => {
  readNostrEventUrl.mockRejectedValue(new Error('database unavailable'));
  await expect(openExternalUrl(`nostr:${identifier}`, dependencies)).rejects.toThrow('database unavailable');
  expect(open).not.toHaveBeenCalled();
});
