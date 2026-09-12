import { queryNip05Profile } from '@/lib/nostr/nip05';
import { resolveNostrUserInput } from '@/lib/nostr/user-input';

jest.mock('@/lib/nostr/nip05', () => ({
  ...jest.requireActual('@/lib/nostr/nip05'),
  queryNip05Profile: jest.fn(),
}));

const queryNip05ProfileMock = queryNip05Profile as jest.MockedFunction<
  typeof queryNip05Profile
>;

describe('resolveNostrUserInput', () => {
  beforeEach(() => {
    queryNip05ProfileMock.mockReset();
  });

  it('resolves a public key locally without a NIP-05 request', async () => {
    const pubkey = 'a'.repeat(64);

    await expect(resolveNostrUserInput(pubkey)).resolves.toEqual({
      status: 'resolved',
      pubkey,
    });
    expect(queryNip05ProfileMock).not.toHaveBeenCalled();
  });

  it('resolves a NIP-05 identifier', async () => {
    const pubkey = 'b'.repeat(64);
    queryNip05ProfileMock.mockResolvedValue({
      identifier: 'alice@example.com',
      pubkey,
    });

    await expect(resolveNostrUserInput('alice@Example.com')).resolves.toEqual({
      status: 'resolved',
      pubkey,
    });
    expect(queryNip05ProfileMock).toHaveBeenCalledWith('alice@Example.com');
  });

  it('distinguishes an unresolved NIP-05 identifier from invalid input', async () => {
    queryNip05ProfileMock.mockResolvedValue(null);

    await expect(resolveNostrUserInput('alice@example.com')).resolves.toEqual({
      status: 'nip05_not_found',
    });
    await expect(resolveNostrUserInput('not a user identifier')).resolves.toEqual({
      status: 'invalid',
    });
    expect(queryNip05ProfileMock).toHaveBeenCalledTimes(1);
  });

  it('completes a bare name on the app NIP-05 domain', async () => {
    const pubkey = 'c'.repeat(64);
    queryNip05ProfileMock.mockResolvedValue({
      identifier: 'alice@psstpsst.chat',
      pubkey,
    });

    await expect(resolveNostrUserInput('Alice')).resolves.toEqual({
      status: 'resolved',
      pubkey,
    });
    expect(queryNip05ProfileMock).toHaveBeenCalledWith('alice@psstpsst.chat');
  });

  it('reports a missing bare name as nip05_not_found', async () => {
    queryNip05ProfileMock.mockResolvedValue(null);

    await expect(resolveNostrUserInput('alice')).resolves.toEqual({
      status: 'nip05_not_found',
    });
    expect(queryNip05ProfileMock).toHaveBeenCalledWith('alice@psstpsst.chat');
  });
});
