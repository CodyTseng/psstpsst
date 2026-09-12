import { platform } from '@/platform';
import { withStagedBackupFile } from '../stage-backup-file';

jest.mock('@/platform', () => ({
  platform: {
    fileSystem: {
      cacheDirectoryUri: jest.fn(async () => 'cache/'),
      openWriteHandle: jest.fn(),
      delete: jest.fn(async () => {}),
    },
    deviceCrypto: { randomUUID: jest.fn(async () => 'test') },
  },
}));

const chunkSize = 1024 * 1024;
const writer = { writeBytes: jest.fn(), close: jest.fn() };
function input(size: number) {
  return {
    size,
    slice: jest.fn((start: number, end: number) => ({
      arrayBuffer: async () => new ArrayBuffer(Math.min(end, size) - start),
    })),
  } as unknown as Blob;
}

beforeEach(() => {
  jest.clearAllMocks();
  writer.writeBytes.mockResolvedValue(undefined);
  writer.close.mockResolvedValue(undefined);
  jest.mocked(platform.fileSystem.openWriteHandle).mockResolvedValue(writer);
});

it('copies bounded chunks and closes the file before consuming it', async () => {
  const file = input(chunkSize * 2 + 3);
  const consume = jest.fn(async (uri) => {
    expect(uri).toBe('cache/backup-drop-test');
    expect(writer.close).toHaveBeenCalledTimes(1);
    expect(platform.fileSystem.delete).not.toHaveBeenCalled();
    return 'imported';
  });
  await expect(withStagedBackupFile(file, consume)).resolves.toBe('imported');
  expect(writer.writeBytes.mock.calls.map(([bytes]) => bytes.length)).toEqual([
    chunkSize, chunkSize, 3,
  ]);
  expect(platform.fileSystem.delete).toHaveBeenCalledWith('cache/backup-drop-test', {
    idempotent: true,
  });
});

it('closes and deletes partial input when staging fails', async () => {
  writer.writeBytes.mockRejectedValueOnce(new Error('disk full'));
  const consume = jest.fn();
  await expect(withStagedBackupFile(input(3), consume)).rejects.toThrow('disk full');
  expect(writer.close).toHaveBeenCalledTimes(1);
  expect(platform.fileSystem.delete).toHaveBeenCalledTimes(1);
  expect(consume).not.toHaveBeenCalled();
});

it('cleans up after invalid input without masking the import failure', async () => {
  jest.mocked(platform.fileSystem.delete).mockRejectedValueOnce(new Error('cleanup'));
  await expect(withStagedBackupFile(input(3), async () => {
    throw new Error('invalid backup');
  })).rejects.toThrow('invalid backup');
  expect(platform.fileSystem.delete).toHaveBeenCalledTimes(1);
});
