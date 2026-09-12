import { dmService } from '@/services/dm/dm.service';
import { markDownloaded } from '@/services/files/attachment-index.service';
import {
  stageNearbyAttachment,
  uploadAttachment,
} from '@/services/files/file-attachment.service';
import { loadAccountMediaServers } from '@/services/files/media-server.service';
import {
  ensureNearbyFileRemotelyAvailable,
  nearbyFileUploadService,
} from '@/services/files/nearby-file-upload.service';
import { proximityService } from '@/services/proximity/proximity.service';

import { conversationSendService } from '../conversation-send.service';

jest.mock('@/services/dm/dm.service', () => ({
  dmService: {
    sendMessage: jest.fn(),
    sendReaction: jest.fn(),
    forwardMessage: jest.fn(),
  },
}));
jest.mock('@/services/proximity/proximity.service', () => ({
  proximityService: {
    assertConversationWritable: jest.fn(),
    sendMessage: jest.fn(),
    sendReaction: jest.fn(),
    forwardMessage: jest.fn(),
  },
}));
jest.mock('@/services/files/file-attachment.service', () => ({
  stageNearbyAttachment: jest.fn(),
  uploadAttachment: jest.fn(),
}));
jest.mock('@/services/files/nearby-file-upload.service', () => ({
  ensureNearbyFileRemotelyAvailable: jest.fn(),
  nearbyFileUploadService: {
    waitUntilAvailable: jest.fn(),
    preferUntilAvailable: jest.fn(),
  },
}));
jest.mock('@/services/files/media-server.service', () => ({
  loadAccountMediaServers: jest.fn(),
}));
jest.mock('@/services/files/attachment-index.service', () => ({
  markDownloaded: jest.fn(),
}));

const mockDmService = dmService as unknown as {
  sendMessage: jest.Mock;
  sendReaction: jest.Mock;
  forwardMessage: jest.Mock;
};
const mockProximityService = proximityService as unknown as {
  assertConversationWritable: jest.Mock;
  sendMessage: jest.Mock;
  sendReaction: jest.Mock;
  forwardMessage: jest.Mock;
};
const mockUploadAttachment = uploadAttachment as jest.Mock;
const mockStageNearbyAttachment = stageNearbyAttachment as jest.Mock;
const mockWaitUntilAvailable = nearbyFileUploadService.waitUntilAvailable as jest.Mock;
const mockPreferUntilAvailable = nearbyFileUploadService.preferUntilAvailable as jest.Mock;
const mockEnsureNearbyFileRemotelyAvailable = ensureNearbyFileRemotelyAvailable as jest.Mock;
const mockLoadAccountMediaServers = loadAccountMediaServers as jest.Mock;
const mockMarkDownloaded = markDownloaded as jest.Mock;

describe('conversation send service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockDmService.sendMessage.mockResolvedValue({ rumorId: 'relay-message' });
    mockDmService.sendReaction.mockResolvedValue({ rumorId: 'relay-reaction' });
    mockDmService.forwardMessage.mockResolvedValue({
      rumorId: 'relay-forward',
    });
    mockProximityService.sendMessage.mockResolvedValue({
      id: 'nearby-message',
    });
    mockProximityService.sendReaction.mockResolvedValue({
      id: 'nearby-reaction',
    });
    mockProximityService.forwardMessage.mockResolvedValue({
      id: 'nearby-forward',
    });
    mockProximityService.assertConversationWritable.mockResolvedValue({});
    mockWaitUntilAvailable.mockResolvedValue(undefined);
    mockPreferUntilAvailable.mockResolvedValue(true);
    mockEnsureNearbyFileRemotelyAvailable.mockResolvedValue(undefined);
  });

  it('dispatches the same authored message payload through either transport', async () => {
    const extraTags = [['emoji', 'party', 'https://example.com/party.png']];

    await conversationSendService.sendMessage({
      accountPubkey: 'account',
      target: { deliveryKind: 'relay', conversationKey: 'relay-peer' },
      content: ':party:',
      extraTags,
    });
    await conversationSendService.sendMessage({
      accountPubkey: 'account',
      target: { deliveryKind: 'proximity', conversationKey: 'nearby-peer' },
      content: ':party:',
      extraTags,
    });

    expect(mockDmService.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({ content: ':party:', extraTags }),
    );
    expect(mockProximityService.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({ content: ':party:', extraTags }),
    );
  });

  it('prefers a Proximity-signed Blossom upload before publishing Nearby metadata', async () => {
    mockLoadAccountMediaServers.mockResolvedValue(['https://media.example']);
    mockStageNearbyAttachment.mockResolvedValue({
      url: 'blossom:cipher.bin?xs=https%3A%2F%2Fmedia.example',
      tags: [['file-type', 'image/jpeg']],
      meta: {
        cipherSha256Hex: 'cipher-hash',
        plainSha256Hex: 'plain-hash',
        mime: 'image/jpeg',
      },
      localSize: 123,
      storedLocally: true,
      localUri: 'file:///cached-photo.jpg',
    });
    const order: string[] = [];
    const onLocalFileReady = jest.fn(async () => {
      order.push('warm');
    });
    const onUploadReady = jest.fn(() => {
      order.push('correlate');
    });
    const onStep = jest.fn((step: string) => {
      if (step === 'publishing') order.push('publishing');
    });
    mockDmService.forwardMessage.mockImplementation(async () => {
      order.push('publish-relay');
      return { rumorId: 'relay-forward' };
    });
    mockProximityService.forwardMessage.mockImplementation(async () => {
      order.push('publish-nearby');
      return { id: 'nearby-forward' };
    });
    mockPreferUntilAvailable.mockImplementation(async () => {
      order.push('upload');
      return true;
    });

    const result = await conversationSendService.sendFile({
      accountPubkey: 'account',
      signer: {} as never,
      targets: [
        { deliveryKind: 'relay', conversationKey: 'relay-peer' },
        { deliveryKind: 'proximity', conversationKey: 'nearby-peer' },
      ],
      localUri: 'file:///photo.jpg',
      mime: 'image/jpeg',
      onLocalFileReady,
      onUploadReady,
      onStep,
    });

    expect(mockStageNearbyAttachment).toHaveBeenCalledTimes(1);
    expect(mockUploadAttachment).not.toHaveBeenCalled();
    expect(mockProximityService.assertConversationWritable).toHaveBeenCalledWith(
      'account',
      'nearby-peer',
    );
    expect(mockDmService.forwardMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 15,
        content: 'blossom:cipher.bin?xs=https%3A%2F%2Fmedia.example',
      }),
    );
    expect(mockProximityService.forwardMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 15,
        content: 'blossom:cipher.bin?xs=https%3A%2F%2Fmedia.example',
      }),
    );
    expect(mockMarkDownloaded).toHaveBeenCalledWith(
      'blossom:cipher.bin?xs=https%3A%2F%2Fmedia.example',
      'plain-hash',
      'image/jpeg',
      123,
    );
    expect(onLocalFileReady).toHaveBeenCalledWith({
      uri: 'file:///cached-photo.jpg',
      mime: 'image/jpeg',
    });
    expect(onUploadReady).toHaveBeenCalledWith({
      url: 'blossom:cipher.bin?xs=https%3A%2F%2Fmedia.example',
    });
    expect(mockPreferUntilAvailable).toHaveBeenCalledWith(
      'account',
      'cipher-hash',
      undefined,
      undefined,
    );
    expect(order).toEqual([
      'upload',
      'warm',
      'correlate',
      'publishing',
      'publish-nearby',
      'publish-relay',
    ]);
    expect(result.rumorIds).toEqual(['nearby-forward', 'relay-forward']);
  });

  it('rejects a read-only Nearby target before uploading a file', async () => {
    mockProximityService.assertConversationWritable.mockRejectedValue(new Error('read-only'));

    await expect(
      conversationSendService.sendFile({
        accountPubkey: 'account',
        signer: {} as never,
        targets: [{ deliveryKind: 'proximity', conversationKey: 'archived-peer' }],
        localUri: 'file:///photo.jpg',
        mime: 'image/jpeg',
      }),
    ).rejects.toThrow('read-only');
    expect(mockUploadAttachment).not.toHaveBeenCalled();
    expect(mockStageNearbyAttachment).not.toHaveBeenCalled();
  });

  it('publishes the Nearby rumor when the preferred upload is unavailable', async () => {
    mockLoadAccountMediaServers.mockResolvedValue(['https://media.example']);
    mockStageNearbyAttachment.mockResolvedValue({
      url: 'blossom:cipher.bin?xs=https%3A%2F%2Fmedia.example',
      tags: [],
      meta: { cipherSha256Hex: 'cipher-hash' },
      localSize: 123,
      storedLocally: true,
    });
    mockPreferUntilAvailable.mockResolvedValue(false);

    await conversationSendService.sendFile({
      accountPubkey: 'account',
      signer: {} as never,
      targets: [{ deliveryKind: 'proximity', conversationKey: 'nearby-peer' }],
      localUri: 'file:///photo.jpg',
      mime: 'image/jpeg',
    });

    expect(mockPreferUntilAvailable).toHaveBeenCalledTimes(1);
    expect(mockProximityService.forwardMessage).toHaveBeenCalledTimes(1);
  });

  it('waits for a Nearby Blossom copy before forwarding the rumor to a relay', async () => {
    const x = '11'.repeat(32);
    const order: string[] = [];
    mockEnsureNearbyFileRemotelyAvailable.mockImplementation(async () => {
      order.push('upload');
    });
    mockDmService.forwardMessage.mockImplementation(async () => {
      order.push('publish');
      return { rumorId: 'relay-forward' };
    });
    const tags = [
      ['file-type', 'application/pdf'],
      ['encryption-algorithm', 'aes-gcm'],
      ['decryption-key', '22'.repeat(32)],
      ['decryption-nonce', '33'.repeat(12)],
      ['x', x],
      ['ox', '44'.repeat(32)],
      ['size', '116'],
      ['plain-size', '100'],
    ];

    await conversationSendService.forwardMessage({
      accountPubkey: 'account',
      target: { deliveryKind: 'relay', conversationKey: 'relay-peer' },
      kind: 15,
      content: `blossom:${x}.bin?xs=${encodeURIComponent('https://media.example')}`,
      contentTags: tags,
    });

    expect(mockEnsureNearbyFileRemotelyAvailable).toHaveBeenCalledWith(
      'account',
      expect.objectContaining({ cipherSha256Hex: x, plainSize: 100 }),
      undefined,
      true,
    );
    expect(order).toEqual(['upload', 'publish']);
  });

  it('does not create a gift wrap when cancellation wins before publishing', async () => {
    const controller = new AbortController();
    mockLoadAccountMediaServers.mockResolvedValue(['https://media.example']);
    mockUploadAttachment.mockImplementation(async () => {
      controller.abort();
      return {
        url: 'https://media.example/orphaned-blob',
        tags: [],
        meta: { mime: 'image/jpeg' },
        localSize: 1,
        storedLocally: false,
      };
    });

    await expect(
      conversationSendService.sendFile({
        accountPubkey: 'account',
        signer: {} as never,
        targets: [{ deliveryKind: 'relay', conversationKey: 'relay-peer' }],
        localUri: 'file:///photo.jpg',
        signal: controller.signal,
      }),
    ).rejects.toMatchObject({ name: 'AbortError' });
    expect(mockDmService.forwardMessage).not.toHaveBeenCalled();
    expect(mockProximityService.forwardMessage).not.toHaveBeenCalled();
  });

  it('still sends writable targets when a mixed Nearby target is read-only', async () => {
    mockLoadAccountMediaServers.mockResolvedValue(['https://media.example']);
    mockUploadAttachment.mockResolvedValue({
      url: 'https://media.example/blob',
      tags: [],
      meta: {},
      localSize: 1,
      storedLocally: false,
    });
    mockProximityService.assertConversationWritable.mockRejectedValue(new Error('read-only'));

    await expect(
      conversationSendService.sendFile({
        accountPubkey: 'account',
        signer: {} as never,
        targets: [
          { deliveryKind: 'relay', conversationKey: 'relay-peer' },
          { deliveryKind: 'proximity', conversationKey: 'archived-peer' },
        ],
        localUri: 'file:///photo.jpg',
      }),
    ).rejects.toThrow('read-only');
    expect(mockUploadAttachment).toHaveBeenCalledTimes(1);
    expect(mockDmService.forwardMessage).toHaveBeenCalledTimes(1);
    expect(mockProximityService.forwardMessage).not.toHaveBeenCalled();
  });
});
