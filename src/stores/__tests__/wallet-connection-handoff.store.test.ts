import { useWalletConnectionHandoffStore } from '../wallet-connection-handoff.store';

describe('wallet connection handoff', () => {
  afterEach(() => useWalletConnectionHandoffStore.setState({ pending: null }));

  it('keeps the connection string in memory until the matching route consumes it', () => {
    const id = useWalletConnectionHandoffStore.getState().start({
      accountPubkey: 'account',
      connectionString: 'nostr+walletconnect://connection',
    });

    expect(useWalletConnectionHandoffStore.getState().consume(id, 'account')).toBe(
      'nostr+walletconnect://connection',
    );
    expect(useWalletConnectionHandoffStore.getState().pending).toBeNull();
  });

  it('does not expose a connection to another account or stale route', () => {
    const id = useWalletConnectionHandoffStore.getState().start({
      accountPubkey: 'account',
      connectionString: 'nostr+walletconnect://connection',
    });

    expect(useWalletConnectionHandoffStore.getState().consume(id, 'other')).toBeNull();
    expect(useWalletConnectionHandoffStore.getState().consume(id + 1, 'account')).toBeNull();
    expect(useWalletConnectionHandoffStore.getState().pending?.id).toBe(id);
  });
});
