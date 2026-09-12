import type { Rumor } from '@/db/schema/types';
import { MessagingKeySyncRequiredError, receiveSessionStore } from '@/services/dm/receive-session';

type TaskExecution = { signal: AbortSignal };

let mockRun: ((execution: TaskExecution) => Promise<void>) | null = null;
let mockEnabled = true;
let mockRumors: Rumor[] = [];
const mockPoll = jest.fn(
  async (_pubkey: string, _options?: { abort?: AbortSignal }) => mockRumors,
);
const mockNotify = jest.fn(
  async (_rumors: Rumor[], _options?: { flushImmediately?: boolean }) => {},
);
const mockRefreshBadge = jest.fn(async (_pubkey: string) => {});
const mockRegister = jest.fn(async (_minutes: number) => {});
const mockUnregister = jest.fn(async () => {});
const mockStopResident = jest.fn(async () => {});

jest.mock('@/platform', () => ({
  platform: {
    backgroundMessaging: { stop: () => mockStopResident() },
    backgroundTask: {
      defineTasks: (_names: string[], run: (execution: TaskExecution) => Promise<void>) => {
        mockRun = run;
      },
      register: (minutes: number) => mockRegister(minutes),
      unregister: () => mockUnregister(),
    },
  },
}));

jest.mock('@/services/account/account.service', () => ({
  getActiveAccountPubkey: jest.fn(async () => 'account-pubkey'),
}));

jest.mock('@/services/conversation/unread-count.service', () => ({
  refreshUnreadIndicator: (pubkey: string) => mockRefreshBadge(pubkey),
}));

jest.mock('@/services/dm/dm.service', () => ({
  dmService: {
    pollForNotifications: (pubkey: string, options?: { abort?: AbortSignal }) =>
      mockPoll(pubkey, options),
  },
}));

jest.mock('../notification-prefs', () => ({
  getNotificationsEnabled: jest.fn(async () => mockEnabled),
}));

jest.mock('../notification.service', () => ({
  notificationService: {
    notifyNewRumors: (rumors: Rumor[], options?: { flushImmediately?: boolean }) =>
      mockNotify(rumors, options),
  },
}));

function rumor(id: string): Rumor {
  return { id } as Rumor;
}

type BackgroundTaskModule = typeof import('../background-task');
let backgroundTaskModule: BackgroundTaskModule;

describe('background notification task', () => {
  beforeAll(() => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- load after mock state exists
    backgroundTaskModule = require('../background-task') as BackgroundTaskModule;
  });

  beforeEach(() => {
    receiveSessionStore.setState({ status: 'stopped', accountPubkey: null }, true);
    mockEnabled = true;
    mockRumors = [];
    mockPoll.mockClear();
    mockNotify.mockClear();
    mockRefreshBadge.mockClear();
    mockRegister.mockClear();
    mockUnregister.mockClear();
    mockStopResident.mockClear();
  });

  it('hands newly-stored rumors to the funnel and refreshes the badge', async () => {
    mockRumors = [rumor('r1'), rumor('r2')];

    const signal = new AbortController().signal;
    await mockRun!({ signal });

    expect(mockPoll).toHaveBeenCalledWith('account-pubkey', { abort: signal });
    expect(mockNotify).toHaveBeenCalledWith(mockRumors, { flushImmediately: true, accountPubkey: 'account-pubkey' });
    expect(mockRefreshBadge).toHaveBeenCalledWith('account-pubkey');
  });

  it('does no network work while notifications are disabled', async () => {
    mockEnabled = false;

    await mockRun!({ signal: new AbortController().signal });

    expect(mockPoll).not.toHaveBeenCalled();
  });

  it('does no cold-start work after the OS expires the task', async () => {
    const controller = new AbortController();
    controller.abort();

    await mockRun!({ signal: controller.signal });

    expect(mockPoll).not.toHaveBeenCalled();
  });

  it('stops resident and periodic work when a cold poll discovers a new key', async () => {
    receiveSessionStore.setState({
      status: 'key-required', accountPubkey: 'account-pubkey', encryptionPubkey: 'new-key',
    }, true);
    mockPoll.mockRejectedValueOnce(new MessagingKeySyncRequiredError('new-key'));
    await mockRun!({ signal: new AbortController().signal });
    expect(mockStopResident).toHaveBeenCalledTimes(1);
    expect(mockUnregister).toHaveBeenCalledTimes(1);
    expect(mockNotify).not.toHaveBeenCalled();
  });

  it('does not stop a replacement session after an obsolete poll reports a key change', async () => {
    receiveSessionStore.setState({ status: 'ready', accountPubkey: 'new-account' }, true);
    mockPoll.mockRejectedValueOnce(new MessagingKeySyncRequiredError('old-session-key'));
    await mockRun!({ signal: new AbortController().signal });
    expect(mockUnregister).not.toHaveBeenCalled();
    expect(mockStopResident).not.toHaveBeenCalled();
  });

  it('keeps periodic recovery registered on a transient network failure', async () => {
    mockPoll.mockRejectedValueOnce(new Error('offline'));
    await expect(mockRun!({ signal: new AbortController().signal })).rejects.toThrow('offline');
    expect(mockUnregister).not.toHaveBeenCalled();
    expect(mockStopResident).not.toHaveBeenCalled();
  });

  it('registers at the platform minimum and unregisters through the port', async () => {
    await backgroundTaskModule.registerBackgroundPoll();
    await backgroundTaskModule.unregisterBackgroundPoll();

    expect(mockRegister).toHaveBeenCalledWith(15);
    expect(mockUnregister).toHaveBeenCalledTimes(1);
  });
});
