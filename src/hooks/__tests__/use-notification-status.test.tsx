import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { useNotificationStatus } from '../use-notification-status';

let mockGranted = false;
let mockEnabled = true;
const mockListeners = new Set<() => void>();
const mockGetStatus = jest.fn(async () => ({ enabled: mockEnabled, granted: mockGranted }));
const mockEnable = jest.fn(async () => {
  mockEnabled = mockGranted;
  return { enabled: mockEnabled, granted: mockGranted };
});
const mockDisable = jest.fn(async () => { mockEnabled = false; });
const mockOpenSettings = jest.fn(async () => true);

jest.mock('@/services/notifications/notification.service', () => ({
  notificationService: {
    getStatus: () => mockGetStatus(),
    enable: () => mockEnable(),
    disable: () => mockDisable(),
  },
}));
jest.mock('@/platform', () => ({
  platform: { notifications: {
    openSettings: () => mockOpenSettings(),
    addUserReturnedListener: (listener: () => void) => {
      mockListeners.add(listener);
      return () => { mockListeners.delete(listener); };
    },
  } },
}));

describe('notification settings authorization', () => {
  let renderer: ReactTestRenderer;
  let result: ReturnType<typeof useNotificationStatus>;
  function Harness() {
    result = useNotificationStatus();
    return null;
  }
  async function mount() {
    await act(async () => { renderer = create(<Harness />); });
  }
  async function returnToApp() {
    await act(async () => { mockListeners.forEach(listener => listener()); });
  }
  beforeEach(() => {
    jest.clearAllMocks();
    mockGranted = false;
    mockEnabled = true;
  });
  afterEach(() => {
    act(() => renderer?.unmount());
    expect(mockListeners.size).toBe(0);
  });

  it('shows off when the app preference is on but macOS denies notifications', async () => {
    await mount();
    expect(result.enabled).toBe(false);
    expect(mockEnable).not.toHaveBeenCalled();
  });

  it('refreshes grants and revocations on return without requesting authorization', async () => {
    mockGranted = true;
    await mount();
    expect(result.enabled).toBe(true);
    mockGranted = false;
    await returnToApp();
    expect(result.enabled).toBe(false);
    mockGranted = true;
    await returnToApp();
    expect(result.enabled).toBe(true);
    expect(mockEnable).not.toHaveBeenCalled();
  });

  it('finishes an explicit enable action after the user grants permission in Settings', async () => {
    await mount();
    await act(async () => { await result.toggle(true); });
    expect(result.enabled).toBe(false);
    await act(async () => { await result.openSettings(); });
    await returnToApp();
    expect(result.enabled).toBe(false);
    expect(mockEnable).toHaveBeenCalledTimes(1);
    mockGranted = true;
    await returnToApp();
    expect(result.enabled).toBe(true);
    expect(mockEnable).toHaveBeenCalledTimes(2);
  });

  it('does not enable an app-disabled preference merely because the OS grants permission', async () => {
    mockEnabled = false;
    mockGranted = true;
    await mount();
    await returnToApp();
    expect(result.enabled).toBe(false);
    expect(mockEnable).not.toHaveBeenCalled();
  });

  it('ignores a stale status read that resolves after the user disables notifications', async () => {
    mockGranted = true;
    await mount();
    let complete!: (status: { enabled: boolean; granted: boolean }) => void;
    mockGetStatus.mockImplementationOnce(() => new Promise(resolve => { complete = resolve; }));
    await returnToApp();
    await act(async () => { await result.toggle(false); });
    await act(async () => { complete({ enabled: true, granted: true }); });
    expect(result.enabled).toBe(false);
  });
});
