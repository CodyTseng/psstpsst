import type { ElectronBridge } from '../bridge';
import { electronFileSystemAdapter } from '../file-system';

function installBridge(fileSystem: Partial<ElectronBridge['fileSystem']>): void {
  window.psstpsstDesktop = {
    fileSystem: fileSystem as ElectronBridge['fileSystem'],
  } as ElectronBridge;
}

describe('Electron file-system adapter', () => {
  afterEach(() => {
    delete window.psstpsstDesktop;
  });

  it('reports reveal-in-folder unavailable when the preload has not restarted', async () => {
    installBridge({});

    await expect(
      electronFileSystemAdapter.revealInFolder('psstpsst-file://documents/archive.zip'),
    ).resolves.toBe(false);
  });

  it('delegates reveal-in-folder to an updated preload', async () => {
    const revealInFolder = jest.fn().mockResolvedValue(true);
    installBridge({ revealInFolder });

    await expect(
      electronFileSystemAdapter.revealInFolder('psstpsst-file://documents/archive.zip'),
    ).resolves.toBe(true);
    expect(revealInFolder).toHaveBeenCalledWith(
      'psstpsst-file://documents/archive.zip',
    );
  });

  it('forwards an abort to the main-process upload operation', async () => {
    const uploadFile = jest.fn().mockResolvedValue({ status: 200, body: '{}' });
    const cancelUpload = jest.fn().mockResolvedValue(undefined);
    installBridge({ uploadFile, cancelUpload });
    const controller = new AbortController();

    const upload = electronFileSystemAdapter.uploadFile(
      'https://media.example/upload',
      'psstpsst-file://cache/cipher.bin',
      { httpMethod: 'PUT', signal: controller.signal },
    );
    controller.abort();
    await expect(upload).rejects.toMatchObject({ name: 'AbortError' });

    const operationId = uploadFile.mock.calls[0][3];
    expect(operationId).toEqual(expect.any(String));
    expect(cancelUpload).toHaveBeenCalledWith(operationId);
  });

  it('forwards progress for only the matching upload operation', async () => {
    const uploadFile = jest.fn();
    let progressListener:
      | ((value: { operationId: string; sentBytes: number; totalBytes: number }) => void)
      | undefined;
    const addUploadProgressListener = jest.fn((listener) => {
      progressListener = listener;
      return jest.fn();
    });
    uploadFile.mockImplementation(async (_url, _fileUri, _options, nextOperationId) => {
      progressListener?.({ operationId: 'different', sentBytes: 1, totalBytes: 10 });
      progressListener?.({ operationId: String(nextOperationId), sentBytes: 5, totalBytes: 10 });
      return { status: 200, body: '{}' };
    });
    installBridge({ uploadFile, addUploadProgressListener });
    const onProgress = jest.fn();

    await electronFileSystemAdapter.uploadFile(
      'https://media.example/upload',
      'psstpsst-file://cache/cipher.bin',
      { httpMethod: 'PUT', onProgress },
    );

    expect(onProgress).toHaveBeenCalledTimes(1);
    expect(onProgress).toHaveBeenCalledWith(5, 10);
  });

  it('opens resumable handles at their durable offsets', async () => {
    const openReadHandle = jest.fn().mockResolvedValue({ id: 'read', size: 100 });
    const openWriteHandle = jest.fn().mockResolvedValue('write');
    installBridge({
      openReadHandle,
      readHandle: jest.fn().mockResolvedValue(new Uint8Array()),
      closeReadHandle: jest.fn().mockResolvedValue(undefined),
      openWriteHandle,
      writeHandle: jest.fn().mockResolvedValue(undefined),
      closeWriteHandle: jest.fn().mockResolvedValue(undefined),
    });

    const reader = await electronFileSystemAdapter.openReadHandle(
      'psstpsst-file://documents/plain.bin',
      { offset: 40 },
    );
    await electronFileSystemAdapter.openWriteHandle(
      'psstpsst-file://documents/partial.bin',
      { offset: 40, truncate: false },
    );

    expect(reader.offset).toBe(40);
    expect(openReadHandle).toHaveBeenCalledWith(
      'psstpsst-file://documents/plain.bin',
      40,
    );
    expect(openWriteHandle).toHaveBeenCalledWith(
      'psstpsst-file://documents/partial.bin',
      40,
      false,
    );
  });

  it('routes remote file requests through the main-process bridge', async () => {
    const requestRemoteFile = jest.fn().mockResolvedValue({
      status: 206,
      headers: { 'content-range': 'bytes 4-7/8' },
      body: Uint8Array.of(4, 5, 6, 7),
    });
    installBridge({
      requestRemoteFile,
      cancelRemoteFileRequest: jest.fn().mockResolvedValue(undefined),
    });

    await expect(
      electronFileSystemAdapter.requestRemoteFile('https://media.example/hash.bin', {
        method: 'GET',
        headers: { Range: 'bytes=4-7' },
      }),
    ).resolves.toEqual({
      status: 206,
      headers: { 'content-range': 'bytes 4-7/8' },
      body: Uint8Array.of(4, 5, 6, 7),
    });
    expect(requestRemoteFile).toHaveBeenCalledWith(
      'https://media.example/hash.bin',
      { method: 'GET', headers: { Range: 'bytes=4-7' }, readBody: undefined },
      expect.stringMatching(/^renderer-remote-/),
    );
  });
});
