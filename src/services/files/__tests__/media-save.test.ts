const mockRequestWritePermission = jest.fn<Promise<boolean>, []>();
const mockSaveToLibrary = jest.fn<Promise<void>, [string]>();
const mockCacheDirectoryUri = jest.fn<Promise<string | null>, []>();
const mockMakeDirectory = jest.fn<Promise<void>, [string, object?]>();
const mockWriteBytes = jest.fn<Promise<void>, [string, Uint8Array]>();
const mockDelete = jest.fn<Promise<void>, [string, object?]>();

jest.mock('@/platform', () => ({
  platform: {
    mediaLibrary: {
      requestWritePermission: () => mockRequestWritePermission(),
      saveToLibrary: (uri: string) => mockSaveToLibrary(uri),
    },
    fileSystem: {
      cacheDirectoryUri: () => mockCacheDirectoryUri(),
      makeDirectory: (uri: string, options?: object) => mockMakeDirectory(uri, options),
      writeBytes: (uri: string, bytes: Uint8Array) => mockWriteBytes(uri, bytes),
      delete: (uri: string, options?: object) => mockDelete(uri, options),
    },
  },
}));

jest.mock('../file-attachment.service', () => ({
  fetchAndDecryptAttachment: jest.fn(),
  getCachedAttachmentUri: jest.fn(),
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports -- mocks must install first
const { saveUriToLibrary } = require('../media-save.service') as typeof import('../media-save.service');

describe('media library saves', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    jest.clearAllMocks();
    mockRequestWritePermission.mockResolvedValue(true);
    mockSaveToLibrary.mockResolvedValue(undefined);
    mockCacheDirectoryUri.mockResolvedValue('psstpsst-file://cache/');
    mockMakeDirectory.mockResolvedValue(undefined);
    mockWriteBytes.mockResolvedValue(undefined);
    mockDelete.mockResolvedValue(undefined);
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('saves local files without staging them', async () => {
    const uri = 'psstpsst-file://cache/photo.png';

    await expect(saveUriToLibrary(uri)).resolves.toBe('saved');

    expect(mockSaveToLibrary).toHaveBeenCalledWith(uri);
    expect(mockWriteBytes).not.toHaveBeenCalled();
    expect(mockDelete).not.toHaveBeenCalled();
  });

  it('does not stage a capture when write permission is denied', async () => {
    mockRequestWritePermission.mockResolvedValue(false);

    await expect(saveUriToLibrary('data:image/png;base64,AQID')).resolves.toBe('denied');

    expect(mockSaveToLibrary).not.toHaveBeenCalled();
    expect(mockWriteBytes).not.toHaveBeenCalled();
  });

  it('stages web captures before saving and removes the temporary file', async () => {
    const bytes = Uint8Array.of(1, 2, 3);
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      arrayBuffer: async () => bytes.buffer,
    });

    await expect(saveUriToLibrary('data:image/png;base64,AQID')).resolves.toBe('saved');

    expect(mockMakeDirectory).toHaveBeenCalledWith(
      'psstpsst-file://cache/psstpsst-media-save/',
      { intermediates: true, idempotent: true },
    );
    const stagedUri = mockWriteBytes.mock.calls[0][0];
    expect(stagedUri).toMatch(
      /^psstpsst-file:\/\/cache\/psstpsst-media-save\/captured-\d+-\d+\.png$/,
    );
    expect(mockWriteBytes.mock.calls[0][1]).toEqual(bytes);
    expect(mockSaveToLibrary).toHaveBeenCalledWith(stagedUri);
    expect(mockDelete).toHaveBeenCalledWith(stagedUri, { idempotent: true });
  });

  it('removes a staged capture when the native save fails', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      arrayBuffer: async () => Uint8Array.of(1).buffer,
    });
    mockSaveToLibrary.mockRejectedValue(new Error('save failed'));

    await expect(saveUriToLibrary('data:image/png;base64,AQ==')).resolves.toBe('failed');

    const stagedUri = mockWriteBytes.mock.calls[0][0];
    expect(mockDelete).toHaveBeenCalledWith(stagedUri, { idempotent: true });
  });
});
