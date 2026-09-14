import { fileSaverAdapter } from '../file-saver';

const mockCopy = jest.fn<Promise<void>, [unknown]>();
const mockCreateFile = jest.fn();
const mockPickDirectory = jest.fn();
const mockFile = jest.fn();

jest.mock('expo-file-system', () => ({
  Directory: { pickDirectoryAsync: () => mockPickDirectory() },
  File: class {
    copy = mockCopy;

    constructor(uri: string) {
      mockFile(uri);
    }
  },
}));

describe('Expo file-saver adapter', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockCopy.mockResolvedValue(undefined);
    mockCreateFile.mockReturnValue({ uri: 'content://destination/report.pdf' });
    mockPickDirectory.mockResolvedValue({ createFile: mockCreateFile });
  });

  it('copies into a user-selected directory with a safe filename', async () => {
    await expect(
      fileSaverAdapter.save('file:///cache/hash.bin', {
        suggestedName: 'report/quarter?.pdf',
        mimeType: 'application/pdf',
      }),
    ).resolves.toBe(true);

    expect(mockCreateFile).toHaveBeenCalledWith(
      'report_quarter_.pdf',
      'application/pdf',
    );
    expect(mockFile).toHaveBeenCalledWith('file:///cache/hash.bin');
    expect(mockCopy).toHaveBeenCalledWith({ uri: 'content://destination/report.pdf' });
  });

  it('returns cancellation when the directory picker is dismissed', async () => {
    mockPickDirectory.mockRejectedValue(new Error('cancelled'));

    await expect(
      fileSaverAdapter.save('file:///cache/hash.bin', {
        suggestedName: 'report.pdf',
      }),
    ).resolves.toBe(false);

    expect(mockCopy).not.toHaveBeenCalled();
  });
});
