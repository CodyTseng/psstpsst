import { act, create, type ReactTestRenderer } from 'react-test-renderer';

import type { AppUpdateStatus } from '@/platform';
import { AppUpdatePromptHost } from '../AppUpdatePromptHost';

let mockCurrentStatus: AppUpdateStatus = { state: 'idle' };
let mockStatusListener: ((status: AppUpdateStatus) => void) | null = null;
const mockConfirm = jest.fn<Promise<boolean>, [unknown]>();
const mockNotify = jest.fn<Promise<void>, [unknown]>(async () => {});
const mockDownload = jest.fn(async () => {
  mockCurrentStatus = { state: 'downloaded', version: '1.2.0' };
  mockStatusListener?.(mockCurrentStatus);
});
const mockInstall = jest.fn(async () => {});
const mockShowToast = jest.fn();

jest.mock('@/lib/platform', () => ({ IS_ELECTRON: true }));
jest.mock('@/platform', () => ({
  platform: {
    appUpdate: {
      getStatus: jest.fn(async () => mockCurrentStatus),
      download: () => mockDownload(),
      install: () => mockInstall(),
      addStatusListener: (listener: (status: AppUpdateStatus) => void) => {
        mockStatusListener = listener;
        return () => {
          mockStatusListener = null;
        };
      },
    },
    confirmationDialog: {
      confirm: (options: unknown) => mockConfirm(options),
      notify: (options: unknown) => mockNotify(options),
    },
  },
}));
jest.mock('@/stores/toast.store', () => ({
  showToast: (message: string) => mockShowToast(message),
}));
jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, values?: { version?: string }) =>
      values?.version ? `${key}:${values.version}` : key,
  }),
}));

describe('AppUpdatePromptHost', () => {
  let renderer: ReactTestRenderer | undefined;

  beforeEach(() => {
    mockCurrentStatus = { state: 'available', version: '1.2.0' };
    mockStatusListener = null;
    mockConfirm.mockReset();
    mockNotify.mockClear();
    mockDownload.mockClear();
    mockInstall.mockClear();
    mockShowToast.mockClear();
  });

  afterEach(() => {
    act(() => renderer?.unmount());
    renderer = undefined;
  });

  async function mount() {
    await act(async () => {
      renderer = create(<AppUpdatePromptHost />);
      await Promise.resolve();
      await Promise.resolve();
    });
  }

  it('does not download when the user declines', async () => {
    mockConfirm.mockResolvedValueOnce(false);

    await mount();

    expect(mockConfirm).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'app_update.available_title',
        confirmLabel: 'app_update.download',
      }),
    );
    expect(mockDownload).not.toHaveBeenCalled();
    expect(mockInstall).not.toHaveBeenCalled();
  });

  it('asks again before installing a downloaded update', async () => {
    mockConfirm.mockResolvedValueOnce(true).mockResolvedValueOnce(false);

    await mount();

    expect(mockDownload).toHaveBeenCalledTimes(1);
    expect(mockShowToast).toHaveBeenCalledWith('app_update.downloading:1.2.0');
    expect(mockConfirm).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        title: 'app_update.ready_title',
        confirmLabel: 'app_update.restart_and_install',
      }),
    );
    expect(mockInstall).not.toHaveBeenCalled();
  });

  it('installs only after both confirmations', async () => {
    mockConfirm.mockResolvedValueOnce(true).mockResolvedValueOnce(true);

    await mount();

    expect(mockDownload).toHaveBeenCalledTimes(1);
    expect(mockInstall).toHaveBeenCalledTimes(1);
  });
});
