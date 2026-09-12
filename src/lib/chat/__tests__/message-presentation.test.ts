import { prepareMessagePresentation } from '../message-presentation';

describe('prepareMessagePresentation', () => {
  it('reuses the immutable model for a message id', () => {
    const first = prepareMessagePresentation({
      messageId: 'same-id',
      kind: 14,
      content: 'hello https://example.com/photo.jpg',
      tags: [],
    });
    const second = prepareMessagePresentation({
      messageId: 'same-id',
      kind: 14,
      content: 'hello https://example.com/photo.jpg',
      tags: [],
    });

    expect(second).toBe(first);
  });

  it('prepares both accepted-media and request-safe content shapes', () => {
    const prepared = prepareMessagePresentation({
      messageId: 'media-id',
      kind: 14,
      content: 'https://example.com/photo.jpg',
      tags: [],
    });

    expect(prepared.embeddedMedia.get('https://example.com/photo.jpg')?.kind).toBe('image');
    expect(prepared.contentBlocksWithMedia).toEqual([
      {
        type: 'media',
        value: 'https://example.com/photo.jpg',
        href: 'https://example.com/photo.jpg',
      },
    ]);
    expect(prepared.contentBlocksWithoutMedia).toBeNull();
  });
});
