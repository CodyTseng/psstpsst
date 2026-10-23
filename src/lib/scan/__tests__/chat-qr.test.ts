import { resolveChatQrScan } from '../chat-qr';
import { nip19 } from 'nostr-tools';

const NWC_CONNECTION =
  `nostr+walletconnect://${'1'.repeat(64)}` +
  `?relay=${encodeURIComponent('wss://relay.example.com')}&secret=${'2'.repeat(64)}`;

describe('chat QR resolver', () => {
  const address = nip19.naddrEncode({ pubkey: 'ab'.repeat(32), kind: 35129, identifier: 'type-zoo', relays: ['wss://relay.example.com'] });
  it.each([address, `nostr:${address}`, `https://napplet.example/app/${address}`])('recognizes a mini-app address and retains relay hints: %s', async (input) => {
    await expect(resolveChatQrScan(input)).resolves.toEqual({ kind: 'application', address: input });
  });

  it.each([35130, 35128, 15128, 15129])('recognizes application naddr kind %s through the shared address classifier', async kind => {
    const value = nip19.naddrEncode({ pubkey: 'ab'.repeat(32), kind, identifier: kind < 30000 ? '' : 'app' });
    await expect(resolveChatQrScan(value)).resolves.toEqual({ kind: 'application', address: value });
  });

  it.each(['https://example.com/app', 'example.com/app'])('routes a website URL to application search: %s', async input => {
    await expect(resolveChatQrScan(input)).resolves.toEqual({ kind: 'application', address: input });
  });

  it.each(['https://pay.example/.well-known/lnurlp/alice', 'https://pay.example/lnurl/pay', 'lightning:https://pay.example/invoice'])('preserves explicit payment links: %s', async input => {
    await expect(resolveChatQrScan(input)).resolves.toEqual({ kind: 'payment', input });
  });

  it.each([15129, 35129, undefined])('recognizes a mini-app event pointer with kind %s', async (kind) => {
    const event = nip19.neventEncode({ id: 'ab'.repeat(32), kind, relays: ['wss://relay.example.com'] });
    await expect(resolveChatQrScan(`nostr:${event}`)).resolves.toEqual({ kind: 'napplet', address: event });
  });

  it('preserves profile scanning and does not classify other event kinds as mini-apps', async () => {
    const pubkey = 'ab'.repeat(32);
    await expect(resolveChatQrScan(pubkey)).resolves.toEqual({ kind: 'chat', pubkey });
    await expect(resolveChatQrScan(`nostr:${nip19.npubEncode(pubkey)}`)).resolves.toEqual({ kind: 'chat', pubkey });
    await expect(resolveChatQrScan(nip19.naddrEncode({ pubkey, kind: 30023, identifier: 'article' }))).resolves.toEqual({ kind: 'invalid' });
    await expect(resolveChatQrScan(nip19.neventEncode({ id: pubkey, kind: 1 }))).resolves.toEqual({ kind: 'invalid' });
    await expect(resolveChatQrScan('nostr:naddr1invalid')).resolves.toEqual({ kind: 'invalid' });
  });

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
