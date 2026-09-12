import {
  areAllComposerFilesMedia,
  composerFilesFromClipboard,
  composerFilesFromDataTransfer,
  composerMediaKind,
  dataTransferHasFiles,
  type BrowserFile,
} from '../composer-file';

function file({
  name = 'image.png',
  type = 'image/png',
  size = 42,
}: Partial<{ name: string; type: string; size: number }> = {}): BrowserFile {
  return { name, type, size } as BrowserFile;
}

describe('composerFilesFromClipboard', () => {
  it('uses file-list payloads before clipboard items', () => {
    const first = file({ name: 'first.png' });
    const fallback = file({ name: 'fallback.png' });

    expect(
      composerFilesFromClipboard({
        clipboardData: {
          files: [first],
          items: [{ kind: 'file', getAsFile: () => fallback }],
        },
      }),
    ).toEqual([
      {
        file: first,
        name: 'first.png',
        mime: 'image/png',
        size: 42,
      },
    ]);
  });

  it('falls back to file clipboard items and ignores text items', () => {
    const image = file({ name: '', type: '', size: 128 });

    expect(
      composerFilesFromClipboard({
        clipboardData: {
          items: [
            { kind: 'string', getAsFile: () => file() },
            { kind: 'file', getAsFile: () => image },
          ],
        },
      }),
    ).toEqual([
      {
        file: image,
        name: undefined,
        mime: 'application/octet-stream',
        size: 128,
      },
    ]);
  });

  it('leaves ordinary text paste untouched', () => {
    expect(
      composerFilesFromClipboard({ clipboardData: { items: [{ kind: 'string' }] } }),
    ).toEqual([]);
    expect(composerFilesFromClipboard(null)).toEqual([]);
  });
});

describe('Electron file drop', () => {
  it('detects a file drag before the browser exposes its files', () => {
    expect(dataTransferHasFiles({ types: ['text/plain', 'Files'] })).toBe(true);
    expect(dataTransferHasFiles({ items: [{ kind: 'file' }] })).toBe(true);
    expect(dataTransferHasFiles({ files: [file()] })).toBe(true);
    expect(dataTransferHasFiles({ types: ['text/plain'] })).toBe(false);
  });

  it('normalizes all dropped files', () => {
    const image = file({ name: 'photo.png' });
    const document = file({ name: 'notes.txt', type: 'text/plain', size: 12 });

    expect(composerFilesFromDataTransfer({ files: [image, document] })).toEqual([
      { file: image, name: 'photo.png', mime: 'image/png', size: 42 },
      { file: document, name: 'notes.txt', mime: 'text/plain', size: 12 },
    ]);
  });

  it('ignores dropped directories', () => {
    expect(
      composerFilesFromDataTransfer({
        files: [file({ name: 'folder' })],
        items: [
          {
            kind: 'file',
            getAsFile: () => file({ name: 'folder' }),
            webkitGetAsEntry: () => ({ isFile: false, isDirectory: true }),
          },
        ],
      }),
    ).toEqual([]);
  });
});

describe('composer media classification', () => {
  it.each([
    ['image/png', 'photo.bin', 'image'],
    ['video/mp4', 'clip.bin', 'video'],
    ['audio/mpeg', 'voice.bin', 'audio'],
    ['application/octet-stream', 'photo.webp', 'image'],
    ['application/octet-stream', 'clip.mov', 'video'],
    ['application/octet-stream', 'voice.flac', 'audio'],
    ['application/pdf', 'document.pdf', null],
  ])('classifies %s / %s as %s', (mime, name, expected) => {
    expect(composerMediaKind({ mime, name })).toBe(expected);
  });

  it('uses the media grid only when every file is image, video, or audio', () => {
    const image = file({ name: 'photo.png' });
    const audio = file({ name: 'voice.mp3', type: 'audio/mpeg' });
    const document = file({ name: 'notes.txt', type: 'text/plain' });
    const composerFile = (browserFile: BrowserFile) => ({
      file: browserFile,
      name: browserFile.name,
      mime: browserFile.type,
      size: browserFile.size,
    });

    expect(areAllComposerFilesMedia([composerFile(image), composerFile(audio)])).toBe(true);
    expect(areAllComposerFilesMedia([composerFile(image), composerFile(document)])).toBe(false);
  });
});
