import { generateSecretKey, getPublicKey, verifyEvent } from 'nostr-tools';

import { NsecSigner } from '../nsec-signer';

jest.mock('../../crypto/nip44', () => ({
  nip44Encrypt: jest.fn(),
  nip44Decrypt: jest.fn(),
}));

describe('NsecSigner key isolation', () => {
  test('does not expose key material through properties or serialization', async () => {
    const signer = new NsecSigner(generateSecretKey());
    expect(Reflect.ownKeys(signer)).toEqual([]);
    expect(JSON.stringify(signer)).toBe('{}');
    expect(Reflect.get(signer, 'privkey')).toBeUndefined();
    // Ordinary properties cannot replace the private key or lifecycle guard.
    Object.assign(signer, { privkey: generateSecretKey(), check: () => {} });
    await signer.destroy();
    await expect(signer.getPublicKey()).rejects.toThrow('destroyed');
  });

  test('signs with an independent copy after the caller clears its input', async () => {
    const input = generateSecretKey();
    const pubkey = getPublicKey(input);
    const signer = new NsecSigner(input);
    input.fill(0);
    expect(await signer.getPublicKey()).toBe(pubkey);
    const event = await signer.signEvent({ kind: 1, content: 'test', tags: [], created_at: 1 });
    expect(event.pubkey).toBe(pubkey);
    expect(verifyEvent(event)).toBe(true);
    await signer.destroy();
  });

  test('destroying one signer does not clear caller-owned or other signer keys', async () => {
    const input = generateSecretKey();
    const pubkey = getPublicKey(input);
    const first = new NsecSigner(input);
    const second = new NsecSigner(input);
    await first.destroy();
    expect(getPublicKey(input)).toBe(pubkey);
    expect(await second.getPublicKey()).toBe(pubkey);
    await expect(first.signEvent({ kind: 1, content: '', tags: [], created_at: 1 }))
      .rejects.toThrow('destroyed');
    await second.destroy();
  });
});
