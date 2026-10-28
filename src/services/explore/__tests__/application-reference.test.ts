import { naddrEncode, neventEncode } from 'nostr-tools/nip19';
import { parseNostrEventReference } from '@/lib/nostr/event-reference';
import { applicationEntryFromAddress, applicationReferenceEntry, isApplicationReference, peekApplicationReference, resolveApplicationReference } from '../application-reference';
import { resolveApplicationMetadata } from '../application-metadata';

jest.mock('../application-metadata', () => ({ resolveApplicationMetadata: jest.fn() }));

const author = 'a'.repeat(64);
it('accepts internal coordinates and immutable IDs without using encoded addresses as identity', () => {
  const key = `35130:${author}:notes`;
  expect(applicationEntryFromAddress(key)?.key).toBe(key);
  const id = 'b'.repeat(64);
  expect(applicationEntryFromAddress(id)?.key).toBe(id);
});
const pointer = (kind: number) => parseNostrEventReference(kind === 5129
  ? neventEncode({ id: 'b'.repeat(64), kind, author, relays: ['wss://relay.example/'] })
  : naddrEncode({ pubkey: author, kind, identifier: kind >= 30000 ? 'app' : '', relays: ['wss://relay.example/'] }))!;

it.each([5129, 15129, 35129, 15128, 35128, 35130])('resolves kind %s through the shared application metadata service', async kind => {
  const reference = pointer(kind), source = applicationReferenceEntry(reference)!;
  expect(isApplicationReference(reference)).toBe(true);
  expect(source.address).toBe(reference.bech32);
  expect(source.kind).toBe(kind === 35130 ? 'napp' : [15128, 35128].includes(kind) ? 'nsite' : 'napplet');
  const entry = { ...source, title: 'Shared app' };
  jest.mocked(resolveApplicationMetadata).mockResolvedValue(entry);
  const signal = new AbortController().signal;
  expect(await resolveApplicationReference(`account-${kind}`, source, signal)).toBe(entry);
  expect(resolveApplicationMetadata).toHaveBeenLastCalledWith(`account-${kind}`, source, signal);
  expect(peekApplicationReference(`account-${kind}`, source)).toBe(entry);
  jest.mocked(resolveApplicationMetadata).mockClear();
  expect(await resolveApplicationReference(`account-${kind}`, source, signal)).toBe(entry);
  expect(resolveApplicationMetadata).not.toHaveBeenCalled();
});

it('caches failures briefly and allows an explicit retry', async () => {
  const source = applicationReferenceEntry(pointer(35130))!;
  const signal = new AbortController().signal;
  jest.mocked(resolveApplicationMetadata).mockRejectedValue(new Error('offline'));
  expect(await resolveApplicationReference('retry-account', source, signal)).toBeNull();
  jest.mocked(resolveApplicationMetadata).mockResolvedValue({ ...source, title: 'Recovered' });
  expect(await resolveApplicationReference('retry-account', source, signal)).toBeNull();
  expect((await resolveApplicationReference('retry-account', source, signal, true))?.title).toBe('Recovered');
});

it('does not cache an aborted lookup as an unavailable application', async () => {
  const source = applicationReferenceEntry(pointer(35130))!;
  const life = new AbortController(); life.abort();
  jest.mocked(resolveApplicationMetadata).mockRejectedValue(new Error('aborted'));
  await expect(resolveApplicationReference('aborted-account', source, life.signal)).rejects.toThrow('aborted');
  expect(peekApplicationReference('aborted-account', source)).toBeUndefined();
});

it('does not reinterpret unrelated or incomplete references as applications', () => {
  expect(isApplicationReference(pointer(30023))).toBe(false);
  expect(applicationReferenceEntry(pointer(30023))).toBeUndefined();
  expect(applicationReferenceEntry({ bech32: 'invalid', kind: 35130, author, relays: [] })).toBeUndefined();
});

it('reconstructs canonical immutable keys without a kind hint and retains relay hints from share addresses', () => {
  const reference = pointer(5129);
  const source = applicationReferenceEntry(reference)!;
  const reconstructed = applicationEntryFromAddress(source.key)!;
  expect(reconstructed.key).toBe(source.key);
  expect(reconstructed.kind).toBe('napplet');
  expect(applicationEntryFromAddress(reference.bech32)?.address).toBe(reference.bech32);
  expect(applicationEntryFromAddress('b'.repeat(64))?.key).toBe(source.key);
  expect(applicationEntryFromAddress(pointer(30023).bech32)).toBeUndefined();
});

it('reconstructs website and device-local keys without list membership', () => {
  expect(applicationEntryFromAddress('https://example.com/path')).toMatchObject({ kind: 'website', address: 'https://example.com/path' });
  expect(applicationEntryFromAddress('local~app')).toMatchObject({ key: 'local~app', kind: 'napp' });
  expect(applicationEntryFromAddress('not-an-address')).toBeUndefined();
});

it('shares preview metadata by event ID without treating a changed kind hint as a different event', async () => {
  const pointer = (kind: number) => applicationEntryFromAddress(neventEncode({ id: 'c'.repeat(64), kind }))!;
  const wrongHint = pointer(5129), otherHint = pointer(1);
  const actual = { ...wrongHint, kind: 'napp' as const, title: 'Actual app' };
  jest.mocked(resolveApplicationMetadata).mockClear().mockResolvedValue(actual);
  const signal = new AbortController().signal;
  expect(await resolveApplicationReference('id-hint-account', wrongHint, signal)).toBe(actual);
  expect(await resolveApplicationReference('id-hint-account', otherHint, signal)).toBe(actual);
  expect(resolveApplicationMetadata).toHaveBeenCalledTimes(1);
});
