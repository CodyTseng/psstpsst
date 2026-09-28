import type { Event, EventTemplate } from 'nostr-tools';

import { reportUser } from '../report.service';

const ACCOUNT = 'a'.repeat(64);
const REPORTED = 'b'.repeat(64);

const mockSignEvent = jest.fn(async (template: EventTemplate): Promise<Event> => ({
  ...template,
  id: 'report-id',
  pubkey: ACCOUNT,
  sig: 'signature',
}));
const mockSigner = { getPublicKey: jest.fn(async () => ACCOUNT), signEvent: mockSignEvent };
const mockPublishEvent = jest.fn();
const mockLoadAccountWriteRelays = jest.fn();

jest.mock('@/services/account/account.service', () => ({
  buildSigner: jest.fn(async () => mockSigner),
}));
jest.mock('@/services/relay/relay-list.service', () => ({
  loadAccountWriteRelays: (...args: unknown[]) => mockLoadAccountWriteRelays(...args),
}));
jest.mock('@/services/relay/relay-pool', () => ({
  relayPool: { publishEvent: (...args: unknown[]) => mockPublishEvent(...args) },
}));

describe('NIP-56 profile reports', () => {
  beforeEach(() => {
    mockSignEvent.mockClear();
    mockPublishEvent.mockReset().mockResolvedValue([
      { url: 'wss://write.example', outcome: { ok: true } },
    ]);
    mockLoadAccountWriteRelays.mockReset().mockResolvedValue(['wss://write.example']);
  });

  it('signs the required kind-1984 p tag and publishes only to the author write relays', async () => {
    const event = await reportUser({
      accountPubkey: ACCOUNT,
      reportedPubkey: REPORTED,
      type: 'impersonation',
      signer: mockSigner,
    });

    expect(mockSignEvent).toHaveBeenCalledWith({
      kind: 1984,
      created_at: expect.any(Number),
      tags: [['p', REPORTED, 'impersonation']],
      content: '',
    });
    expect(mockLoadAccountWriteRelays).toHaveBeenCalledWith(ACCOUNT);
    expect(mockPublishEvent).toHaveBeenCalledWith({
      relays: ['wss://write.example'],
      event,
      signer: mockSigner,
    });
  });

  it('fails when every relay rejects the report', async () => {
    mockPublishEvent.mockResolvedValue([
      { url: 'wss://write.example', outcome: { ok: false, reason: 'blocked' } },
    ]);

    await expect(
      reportUser({
        accountPubkey: ACCOUNT,
        reportedPubkey: REPORTED,
        type: 'spam',
        signer: mockSigner,
      }),
    ).rejects.toThrow('No relay accepted the report.');
  });

  it('rejects reporting the active account before signing', async () => {
    await expect(
      reportUser({
        accountPubkey: ACCOUNT,
        reportedPubkey: ACCOUNT,
        type: 'other',
        signer: mockSigner,
      }),
    ).rejects.toThrow('cannot report itself');
    expect(mockSignEvent).not.toHaveBeenCalled();
  });
});
