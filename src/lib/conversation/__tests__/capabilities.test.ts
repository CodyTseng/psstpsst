import {
  conversationAttachmentSources,
  conversationSupportsContent,
  conversationSupportsIncomingShareItem,
  conversationSupportsMessage,
  fileContentCapability,
} from '../capabilities';

describe('conversation capabilities', () => {
  it('keeps every conversation fully featured', () => {
    expect(conversationSupportsContent('image')).toBe(true);
    expect(conversationSupportsContent('audio')).toBe(true);
    expect(conversationAttachmentSources(true)).toEqual([
      'invoice',
      'camera',
      'library',
      'file',
      'card',
    ]);
    expect(conversationAttachmentSources(false)).toEqual([
      'camera',
      'library',
      'file',
      'card',
    ]);
  });

  it('classifies file MIME types for recipient filtering', () => {
    expect(fileContentCapability('image/jpeg')).toBe('image');
    expect(fileContentCapability('video/mp4')).toBe('video');
    expect(fileContentCapability('audio/m4a')).toBe('audio');
    expect(fileContentCapability('application/pdf')).toBe('file');
  });

  it('allows rich forwarded messages for every transport', () => {
    expect(conversationSupportsMessage({ kind: 14, tags: [] })).toBe(true);
    expect(
      conversationSupportsMessage({
        kind: 14,
        tags: [['emoji', 'party', 'https://example.com/party.png']],
      }),
    ).toBe(true);
    expect(
      conversationSupportsMessage({
        kind: 15,
        tags: [['file-type', 'image/jpeg']],
      }),
    ).toBe(true);
    expect(
      conversationSupportsMessage({
        kind: 14,
        content: 'https://example.com/photo.jpg',
        tags: [],
      }),
    ).toBe(true);
  });

  it('accepts incoming text and file shares for every transport', () => {
    expect(
      conversationSupportsIncomingShareItem({
        kind: 'file',
        id: 'image',
        localUri: 'file:///image.jpg',
        mime: 'image/jpeg',
      }),
    ).toBe(true);
    expect(
      conversationSupportsIncomingShareItem({
        kind: 'text',
        id: 'text',
        content: 'hello',
      }),
    ).toBe(true);
  });
});
