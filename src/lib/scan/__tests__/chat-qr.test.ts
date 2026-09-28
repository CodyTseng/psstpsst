import { resolveChatQrScan } from '../chat-qr';

const NWC_CONNECTION =
  `nostr+walletconnect://${'1'.repeat(64)}` +
  `?relay=${encodeURIComponent('wss://relay.example.com')}&secret=${'2'.repeat(64)}`;

describe('chat QR resolver', () => {
  it('recognizes an NWC connection as a wallet addition', async () => {
    await expect(resolveChatQrScan(`  ${NWC_CONNECTION}  `)).resolves.toEqual({
      kind: 'wallet',
      connectionString: NWC_CONNECTION,
    });
  });

  it('rejects a malformed NWC connection', async () => {
    await expect(
      resolveChatQrScan('nostr+walletconnect://invalid?relay=wss%3A%2F%2Frelay.example.com'),
    ).resolves.toEqual({ kind: 'invalid' });
  });

  it('does not classify a Nostr signer connection as a wallet', async () => {
    const signerConnection =
      `nostrconnect://${'1'.repeat(64)}` +
      `?relay=${encodeURIComponent('wss://relay.example.com')}&secret=${'2'.repeat(64)}`;

    await expect(resolveChatQrScan(signerConnection)).resolves.toEqual({ kind: 'invalid' });
  });
});
