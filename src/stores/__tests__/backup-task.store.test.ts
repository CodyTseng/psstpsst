import { importAccountArchive } from '@/services/dm/dm-backup.service';
import { useBackupTaskStore } from '../backup-task.store';

jest.mock('@/i18n', () => ({ __esModule: true, default: { t: (key: string) => key } }));
jest.mock('@/services/dm/dm-backup.service', () => ({
  BackupError: class extends Error {},
  exportAccountArchive: jest.fn(),
  importAccountArchive: jest.fn(),
}));
jest.mock('@/services/dm/dm-backup-storage', () => ({ shareAccountArchive: jest.fn() }));
jest.mock('@/stores/toast.store', () => ({ showToast: jest.fn() }));

beforeEach(() => {
  jest.clearAllMocks();
  useBackupTaskStore.setState({ status: 'idle' });
});

it('shows busy state before reading a drop and ignores concurrent imports', async () => {
  let finish!: (result: null) => void;
  jest.mocked(importAccountArchive).mockReturnValue(new Promise((resolve) => { finish = resolve; }));
  const file = {} as Blob;
  const task = useBackupTaskStore.getState().startImport('alice', file);
  expect(useBackupTaskStore.getState().status).toBe('running');
  expect(importAccountArchive).not.toHaveBeenCalled();
  await useBackupTaskStore.getState().startImport('bob', {} as Blob);
  await new Promise((resolve) => setTimeout(resolve, 5));
  expect(importAccountArchive).toHaveBeenCalledTimes(1);
  expect(importAccountArchive).toHaveBeenCalledWith('alice', {
    file, onProgress: expect.any(Function),
  });
  finish(null);
  await task;
  expect(useBackupTaskStore.getState().status).toBe('idle');
});

it('keeps the picker entry available without a dropped file', async () => {
  jest.mocked(importAccountArchive).mockResolvedValue(null);
  await useBackupTaskStore.getState().startImport('alice');
  expect(importAccountArchive).toHaveBeenCalledWith('alice', {
    file: undefined, onProgress: expect.any(Function),
  });
});

it('forwards a temporary native drop URI', async () => {
  jest.mocked(importAccountArchive).mockResolvedValue(null);
  await useBackupTaskStore.getState().startImport('alice', {
    uri: 'file:///cache/file-drops/backup.zip',
    name: 'backup.zip',
    temporary: true,
  });
  expect(importAccountArchive).toHaveBeenCalledWith('alice', {
    file: undefined,
    uri: 'file:///cache/file-drops/backup.zip',
    name: 'backup.zip',
    temporary: true,
    onProgress: expect.any(Function),
  });
});

it('rejects drops while an export result is being presented', async () => {
  useBackupTaskStore.setState({ status: 'presenting' });
  await useBackupTaskStore.getState().startImport('alice', {} as Blob);
  expect(importAccountArchive).not.toHaveBeenCalled();
});
