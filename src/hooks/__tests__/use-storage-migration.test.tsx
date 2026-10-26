import { useEffect } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { migrateLegacyStorage } from '@/services/storage/legacy-storage-migration';
import { useStorageMigration } from '../use-storage-migration';

jest.mock('@/services/storage/legacy-storage-migration', () => ({ migrateLegacyStorage: jest.fn() }));
let renderer: ReactTestRenderer;
let state: ReturnType<typeof useStorageMigration>;
function Harness({ enabled }: { enabled: boolean }) {
  const result = useStorageMigration(enabled);
  useEffect(() => { state = result; });
  return null;
}
beforeEach(() => jest.resetAllMocks());
afterEach(() => act(() => renderer?.unmount()));

test('waits for database readiness and unlock, then gates on migration completion', async () => {
  let finish!: () => void;
  jest.mocked(migrateLegacyStorage).mockImplementation(() => new Promise<void>(resolve => { finish = resolve; }));
  await act(async () => { renderer = create(<Harness enabled={false} />); });
  expect(migrateLegacyStorage).not.toHaveBeenCalled();
  expect(state.success).toBe(false);
  await act(async () => { renderer.update(<Harness enabled />); });
  expect(state.success).toBe(false);
  await act(async () => { finish(); });
  expect(state.success).toBe(true);
});

test('a failed upgrade stays blocked until a successful retry', async () => {
  jest.mocked(migrateLegacyStorage).mockRejectedValueOnce(new Error('Write failed')).mockResolvedValueOnce();
  await act(async () => { renderer = create(<Harness enabled />); });
  expect(state.success).toBe(false);
  expect(state.error?.message).toBe('Write failed');
  await act(async () => { state.retry(); });
  expect(state.success).toBe(true);
  expect(state.error).toBeNull();
});
