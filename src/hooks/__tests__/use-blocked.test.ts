import { resolveBlockedStatus } from '../use-blocked';

jest.mock('@/db/client', () => ({ db: {} }));

describe('resolveBlockedStatus', () => {
  const accountPubkey = 'account';
  const pubkey = 'peer';

  it('does not expose retained data until the current query resolves', () => {
    expect(
      resolveBlockedStatus([{ accountPubkey, pubkey }], false, accountPubkey, pubkey),
    ).toBeUndefined();
    expect(resolveBlockedStatus([], false, accountPubkey, pubkey)).toBeUndefined();
  });

  it('returns the resolved result only when it belongs to the requested pair', () => {
    expect(resolveBlockedStatus([], true, accountPubkey, pubkey)).toBe(false);
    expect(resolveBlockedStatus([{ accountPubkey, pubkey }], true, accountPubkey, pubkey)).toBe(
      true,
    );
    expect(
      resolveBlockedStatus(
        [{ accountPubkey: 'previous-account', pubkey }],
        true,
        accountPubkey,
        pubkey,
      ),
    ).toBeUndefined();
  });
});
