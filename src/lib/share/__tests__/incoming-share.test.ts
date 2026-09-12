import type {
  IncomingSharePayload,
  ResolvedIncomingSharePayload,
} from '../incoming-share';

import { normalizeIncomingShare } from '../incoming-share';

describe('normalizeIncomingShare', () => {
  it('keeps text and URLs while removing duplicate values', () => {
    const raw: IncomingSharePayload[] = [
      { shareType: 'text', value: ' hello ' },
      { shareType: 'url', value: 'https://example.com' },
      { shareType: 'text', value: 'hello' },
    ];

    expect(normalizeIncomingShare(raw, [])).toEqual([
      { kind: 'text', id: 'incoming-0', content: 'hello' },
      { kind: 'text', id: 'incoming-1', content: 'https://example.com' },
    ]);
  });

  it('prefers resolved file metadata', () => {
    const raw: IncomingSharePayload[] = [
      { shareType: 'image', value: 'content://temporary', mimeType: 'image/*' },
    ];
    const resolved: ResolvedIncomingSharePayload[] = [
      {
        shareType: 'image',
        value: 'content://temporary',
        contentType: 'image',
        contentUri: 'file:///cache/photo.jpg',
        contentMimeType: 'image/jpeg',
        contentSize: 42,
        originalName: 'photo.jpg',
      },
    ];

    expect(normalizeIncomingShare(raw, resolved)).toEqual([
      {
        kind: 'file',
        id: 'incoming-0',
        localUri: 'file:///cache/photo.jpg',
        mime: 'image/jpeg',
        name: 'photo.jpg',
        size: 42,
      },
    ]);
  });

  it('falls back to the raw URI, MIME type, and decoded filename', () => {
    const raw: IncomingSharePayload[] = [
      { shareType: 'file', value: 'file:///tmp/My%20File.pdf?token=1' },
    ];

    expect(normalizeIncomingShare(raw, [])).toEqual([
      {
        kind: 'file',
        id: 'incoming-0',
        localUri: 'file:///tmp/My%20File.pdf?token=1',
        mime: 'application/octet-stream',
        name: 'My File.pdf',
        size: undefined,
      },
    ]);
  });
});
