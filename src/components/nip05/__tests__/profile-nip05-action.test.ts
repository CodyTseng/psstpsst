import { resolveProfileNip05Action } from '../profile-nip05-action';

describe('resolveProfileNip05Action', () => {
  it('waits for ownership before offering an action', () => {
    expect(resolveProfileNip05Action('alice@example.com', undefined)).toEqual({
      kind: 'loading',
      identifier: null,
    });
  });

  it('offers the claim flow when the key owns no service name', () => {
    expect(resolveProfileNip05Action('alice@example.com', null)).toEqual({
      kind: 'claim',
      identifier: null,
    });
  });

  it('offers to switch a different provider to the owned address', () => {
    expect(resolveProfileNip05Action('alice@example.com', 'alice')).toEqual({
      kind: 'switch',
      identifier: 'alice@psstpsst.chat',
    });
  });

  it('opens management when the draft already uses the owned address', () => {
    expect(resolveProfileNip05Action(' ALICE@PSSTPSST.CHAT ', 'alice')).toEqual({
      kind: 'manage',
      identifier: 'alice@psstpsst.chat',
    });
  });
});
