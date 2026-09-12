import type { FileAttachmentMeta } from '@/lib/nostr/file-tags';

import {
  attachmentExceedsAutoDownloadLimit,
  conversationRemoteContentMode,
  messageRemoteContentMode,
  MAX_AUTO_DOWNLOAD_BYTES,
  remoteContentPolicy,
} from '../remote-content-policy';

const META: FileAttachmentMeta = {
  url: 'https://media.example/file',
  cipherSha256Hex: 'a'.repeat(64),
  decryptionKeyHex: 'b'.repeat(64),
  decryptionNonceHex: 'c'.repeat(24),
};

describe('remoteContentPolicy', () => {
  it('recognizes and loads media from trusted senders', () => {
    expect(remoteContentPolicy('auto')).toEqual({
      recognizeEmbeddedMedia: true,
      loadRemoteMedia: true,
    });
  });

  it('preserves media geometry without loading remote bytes in route previews', () => {
    expect(remoteContentPolicy('hold')).toEqual({
      recognizeEmbeddedMedia: true,
      loadRemoteMedia: false,
    });
  });

  it('keeps remote media as plain links in message requests', () => {
    expect(remoteContentPolicy('request')).toEqual({
      recognizeEmbeddedMedia: false,
      loadRemoteMedia: false,
    });
  });
});

describe('attachment auto-download size policy', () => {
  it('keeps missing and exactly-20-MiB metadata eligible', () => {
    expect(attachmentExceedsAutoDownloadLimit(META)).toBe(false);
    expect(
      attachmentExceedsAutoDownloadLimit({
        ...META,
        size: MAX_AUTO_DOWNLOAD_BYTES,
        plainSize: MAX_AUTO_DOWNLOAD_BYTES,
      }),
    ).toBe(false);
  });

  it('requires explicit loading when either declared size exceeds 20 MiB', () => {
    expect(
      attachmentExceedsAutoDownloadLimit({
        ...META,
        size: MAX_AUTO_DOWNLOAD_BYTES + 1,
      }),
    ).toBe(true);
    expect(
      attachmentExceedsAutoDownloadLimit({
        ...META,
        plainSize: MAX_AUTO_DOWNLOAD_BYTES + 1,
      }),
    ).toBe(true);
  });
});

describe('sender trust', () => {
  it.each(['stranger', 'blocked'] as const)(
    'requires a tap for %s senders even after the conversation loads',
    (relationship) => {
      expect(conversationRemoteContentMode(true, relationship)).toBe('request');
    },
  );

  it('holds unresolved relationships after the conversation loads', () => {
    expect(conversationRemoteContentMode(true, 'unknown')).toBe('hold');
  });

  it('holds route previews and automatically loads confirmed contacts', () => {
    expect(conversationRemoteContentMode(false, 'contact')).toBe('hold');
    expect(conversationRemoteContentMode(true, 'contact')).toBe('auto');
  });

  it('keeps own messages available without trusting incoming messages', () => {
    expect(messageRemoteContentMode('request', true)).toBe('auto');
    expect(messageRemoteContentMode('request', false)).toBe('request');
    expect(messageRemoteContentMode('hold', true)).toBe('hold');
  });
});
