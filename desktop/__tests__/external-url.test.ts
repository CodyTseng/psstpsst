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
  'lightning:lnbc1u1qpzry9x8gf2tvdw0s3jn54khce6mua7l',
  'LIGHTNING:LNTB20N1QPZRY9X8GF2TVDW0S3JN54KHCE6MUA7L',
])(
  'opens a valid Lightning payment request without querying preferences: %s',
  async (value) => {
    await openExternalUrl(value, dependencies);
    expect(open).toHaveBeenCalledWith(value.toLowerCase());
    expect(readNostrEventUrl).not.toHaveBeenCalled();
  },
);

it.each([
  'lightning:javascript:alert(1)',
  'lightning:lnbc1u1qpzry?amount=100',
  'lightning:lnbc1u1qpzry\n',
  'lightning:lnBc1u1qpzry9x8gf2tvdw0s3jn54khce6mua7l',
  `lightning:lnbc1${'q'.repeat(8 * 1024)}`,
])('rejects an invalid Lightning payment request: %s', async (value) => {
  await expect(openExternalUrl(value, dependencies)).rejects.toThrow(
    'Invalid Lightning payment request',
  );
  expect(open).not.toHaveBeenCalled();
  expect(readNostrEventUrl).not.toHaveBeenCalled();
});

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
