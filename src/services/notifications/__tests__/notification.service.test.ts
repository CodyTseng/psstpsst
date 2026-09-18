import type { Rumor } from '@/db/schema/types';

/**
 * Funnel tests for the notification service: one counting path shared by the
 * live `onNewMessage` hook and the background poll, with rumor-id dedup,
 * request/mute gating, the platform "should notify now" gate, and a
 * user-returned reset, and independently opt-in preview details.
 */

let mockEnabledPref = true;
let mockUnreadIndicatorsEnabled = true;
let mockPermission = true;
let mockShouldNotify = true;
let mockFilterAllows = true;
let mockPresentSucceeds = true;
let mockContentPreferences = {
  showSender: false,
  showMessageContent: false,
};
/** Ordered record of OS presentation calls. */
let mockOps: string[] = [];
let mockPresentedBadgeCounts: number[] = [];
let mockPresentedContents: {
  title: string;
  subtitle?: string;
  body?: string;
  avatarUrl?: string;
  badgeCount: number;
}[] = [];
let mockDismissAllCount = 0;
let mockUnregisterCount = 0;
let mockRegisterCount = 0;
let mockRegisterBarrier: Promise<void> | null = null;
let mockBackgroundMessagingStarts: { channelName: string; message: string }[] = [];
let mockBackgroundMessagingStopCount = 0;
let mockBatteryOptimizationPrompted = false;
let mockBatteryOptimizationExempt = false;
let mockBatteryOptimizationRequestCount = 0;
let mockDndActive = false;
let mockBackgroundPulse: (() => void) | null = null;
let mockUserReturned: (() => void) | null = null;
let mockDmListener: { onNewMessage?: (rumor: Rumor) => void } | null = null;

jest.mock('@/platform', () => ({
  platform: {
    notifications: {
      isAvailable: jest.fn(() => true),
      hasPermission: jest.fn(async () => mockPermission),
      ensurePermission: jest.fn(async () => mockPermission),
      setDefaultHandler: jest.fn(),
      present: jest.fn(async (content: {
        title: string;
        subtitle?: string;
        body?: string;
        avatarUrl?: string;
        badgeCount: number;
      }) => {
        mockOps.push(`present:${content.title}`);
        mockPresentedBadgeCounts.push(content.badgeCount);
        mockPresentedContents.push(content);
        return mockPresentSucceeds;
      }),
      dismissAll: jest.fn(async () => {
        mockDismissAllCount += 1;
      }),
      shouldNotifyNow: jest.fn(() => mockShouldNotify),
      addUserReturnedListener: jest.fn((listener: () => void) => {
        mockUserReturned = listener;
      }),
    },
    appState: { currentState: () => 'background', addChangeListener: jest.fn(() => () => {}) },
    backgroundMessaging: {
      schedulePulse: jest.fn(async () => {}),
      isAvailable: jest.fn(() => true),
      isBatteryOptimizationExempt: jest.fn(async () => mockBatteryOptimizationExempt),
      requestBatteryOptimizationExemption: jest.fn(async () => {
        mockBatteryOptimizationRequestCount += 1;
        return true;
      }),
      addPulseListener: jest.fn((listener: () => void) => {
        mockBackgroundPulse = listener;
        return () => {
          mockBackgroundPulse = null;
        };
      }),
      start: jest.fn(async (content: { channelName: string; message: string }) => {
        mockBackgroundMessagingStarts.push(content);
        return true;
      }),
      stop: jest.fn(async () => {
        mockBackgroundMessagingStopCount += 1;
      }),
    },
  },
}));

jest.mock('@/services/dm/dm.service', () => ({
  dmService: {
    addListener: jest.fn((listener: { onNewMessage?: (rumor: Rumor) => void }) => {
      mockDmListener = listener;
      return () => {
        mockDmListener = null;
      };
    }),
    getAccountPubkey: jest.fn(() => 'account-pubkey'),
  },
}));

jest.mock('@/services/account/account.service', () => ({
  getActiveAccountPubkey: jest.fn(async () => 'account-pubkey'),
}));

jest.mock('@/services/conversation/unread-count.service', () => ({
  getMainInboxUnreadCount: jest.fn(async () => 7),
}));

jest.mock('../notification-filter', () => ({
  filterNotifiableMessages: jest.fn(async (rumors: Rumor[]) =>
    mockFilterAllows ? rumors : [],
  ),
}));

jest.mock('../notification-preview', () => ({
  getNotificationPreview: jest.fn(async (value: Rumor) => ({
    displayName: `Alice ${value.id}`,
    messageContent: value.content,
    avatarUrl: `https://example.com/${value.id}.png`,
  })),
}));

jest.mock('@/i18n', () => ({
  __esModule: true,
  default: {
    t: (key: string, options?: { count?: number }) =>
      options?.count !== undefined ? `${key}:${options.count}` : key,
  },
}));

jest.mock('../notification-prefs', () => ({
  DEFAULT_NOTIFICATION_CONTENT_PREFERENCES: {
    showSender: false,
    showMessageContent: false,
  },
  getBatteryOptimizationPrompted: jest.fn(async () => mockBatteryOptimizationPrompted),
  getNotificationContentPreferences: jest.fn(async () => mockContentPreferences),
  getNotificationsEnabled: jest.fn(async () => mockEnabledPref),
  getUnreadIndicatorsEnabled: jest.fn(async () => mockUnreadIndicatorsEnabled),
  setBatteryOptimizationPrompted: jest.fn(async () => {
    mockBatteryOptimizationPrompted = true;
  }),
  setNotificationsEnabled: jest.fn(async (enabled: boolean) => {
    mockEnabledPref = enabled;
  }),
  setNotificationContentPreferences: jest.fn(async (preferences: typeof mockContentPreferences) => {
    mockContentPreferences = preferences;
  }),
  getDndWindow: jest.fn(async () => ({
    enabled: mockDndActive,
    startMinutes: 0,
    endMinutes: 0,
  })),
  setDndWindow: jest.fn(async () => {}),
  isDndActiveNow: jest.fn(async () => mockDndActive),
}));

jest.mock('../background-task', () => ({
  registerBackgroundPoll: jest.fn(async () => { mockRegisterCount++; await mockRegisterBarrier; }),
  unregisterBackgroundPoll: jest.fn(async () => {
    mockUnregisterCount += 1;
  }),
}));

function rumor(id: string, overrides: Partial<Rumor> = {}): Rumor {
  return {
    id,
    pubkey: 'sender-pubkey',
    kind: 14,
    created_at: 1_700_000_000,
    tags: [['p', 'account-pubkey']],
    content: 'hi',
    ...overrides,
  } as Rumor;
}

async function drainMicrotasks(): Promise<void> {
  for (let i = 0; i < 6; i += 1) await Promise.resolve();
}

async function flushAggregation(): Promise<void> {
  await drainMicrotasks();
  await jest.advanceTimersByTimeAsync(1_000);
  await drainMicrotasks();
}

async function notifyAndFlush(
  service: NotificationServiceModule['notificationService'],
  rumors: Rumor[],
): Promise<void> {
  const pending = service.notifyNewRumors(rumors);
  await flushAggregation();
  await pending;
}

type NotificationServiceModule = typeof import('../notification.service');

function receiveSession() {
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- same fresh module graph as the service
  return (require('@/services/dm/receive-session') as typeof import('@/services/dm/receive-session')).receiveSessionStore;
}

async function setReceiveReady(ready: boolean): Promise<void> {
  receiveSession().setState(ready
    ? { status: 'ready', accountPubkey: 'account-pubkey' }
    : { status: 'stopped', accountPubkey: null }, true);
  for (let i = 0; i < 30; i++) await Promise.resolve();
}

async function initService(): Promise<NotificationServiceModule['notificationService']> {
  // Fresh module graph per test: the service is a stateful singleton.
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- intentional per-test re-require after jest.resetModules
  const module = require('../notification.service') as NotificationServiceModule;
  await module.notificationService.init();
  return module.notificationService;
}

describe('notificationService funnel', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.resetModules();

    mockEnabledPref = true;
    mockUnreadIndicatorsEnabled = true;
    mockPermission = true;
    mockShouldNotify = true;
    mockFilterAllows = true;
    mockPresentSucceeds = true;
    mockContentPreferences = {
      showSender: false,
      showMessageContent: false,
    };
    mockOps = [];
    mockPresentedBadgeCounts = [];
    mockPresentedContents = [];
    mockDismissAllCount = 0;
    mockUnregisterCount = 0;
    mockRegisterCount = 0;
    mockRegisterBarrier = null;
    mockBackgroundMessagingStarts = [];
    mockBackgroundMessagingStopCount = 0;
    mockBatteryOptimizationPrompted = false;
    mockBatteryOptimizationExempt = false;
    mockBatteryOptimizationRequestCount = 0;
    mockDndActive = false;
    mockBackgroundPulse = null;
    mockUserReturned = null;
    mockDmListener = null;
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('uses placeholders while preview details are hidden by default', async () => {
    await initService();

    mockDmListener!.onNewMessage!(rumor('r1'));
    await flushAggregation();

    expect(mockOps).toEqual(['present:notifications.new_message']);
    expect(mockPresentedBadgeCounts).toEqual([7]);
    expect(mockPresentedContents).toEqual([
      {
        title: 'notifications.new_message',
        subtitle: undefined,
        body: 'notifications.open_to_view_message',
        avatarUrl: undefined,
        badgeCount: 7,
      },
    ]);
  });

  it('delivers notifications without an app badge when unread indicators are off', async () => {
    mockUnreadIndicatorsEnabled = false;
    await initService();

    mockDmListener!.onNewMessage!(rumor('r1'));
    await flushAggregation();

    expect(mockPresentedBadgeCounts).toEqual([0]);
  });

  it('applies the sender and message-content choices independently', async () => {
    const service = await initService();

    await service.setContentPreferences({
      showSender: true,
      showMessageContent: false,
    });
    await notifyAndFlush(service, [rumor('sender', { content: 'sender body' })]);
    expect(mockPresentedContents.at(-1)).toMatchObject({
      title: 'Alice sender',
      avatarUrl: 'https://example.com/sender.png',
      body: 'notifications.open_to_view_message',
    });

    mockUserReturned!();
    await drainMicrotasks();
    await service.setContentPreferences({
      showSender: false,
      showMessageContent: true,
    });
    await notifyAndFlush(service, [rumor('body', { content: 'visible body' })]);
    expect(mockPresentedContents.at(-1)).toMatchObject({
      title: 'notifications.new_message',
      body: 'visible body',
    });
    expect(mockPresentedContents.at(-1)?.avatarUrl).toBeUndefined();
  });

  it('uses the newest qualifying message for a multi-message preview', async () => {
    mockContentPreferences = {
      showSender: true,
      showMessageContent: true,
    };
    const service = await initService();

    await notifyAndFlush(service, [
      rumor('older', { created_at: 100, content: 'old' }),
      rumor('newer', { created_at: 101, content: 'new' }),
    ]);

    expect(mockPresentedContents.at(-1)).toEqual({
      title: 'Alice newer',
      subtitle: 'notifications.new_messages:2',
      body: 'new',
      avatarUrl: 'https://example.com/newer.png',
      badgeCount: 7,
    });
  });

  it('flushes a due aggregate from a native pulse when JS timers are suspended', async () => {
    const service = await initService();
    await setReceiveReady(true);

    const pending = service.notifyNewRumors([rumor('r1')]);
    await drainMicrotasks();
    jest.setSystemTime(Date.now() + 1_000);
    mockBackgroundPulse!();
    await drainMicrotasks();
    await pending;

    expect(mockOps).toEqual(['present:notifications.new_message']);
  });

  it('delivers a cold background-task batch without waiting on an RN timer', async () => {
    // Do not call init: a WorkManager cold launch imports the singleton but does
    // not start the resident foreground-service pulse.
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- intentional cold module load
    const { notificationService } = require('../notification.service') as NotificationServiceModule;

    await notificationService.notifyNewRumors([rumor('r1'), rumor('r2')], {
      flushImmediately: true,
    });

    expect(mockOps).toEqual(['present:notifications.new_messages:2']);
    expect(jest.getTimerCount()).toBe(0);
  });

  it('keeps an active account resident while notifications are enabled', async () => {
    await initService();

    await setReceiveReady(true);

    expect(mockBackgroundMessagingStarts).toEqual([
      {
        channelName: 'notifications.channel_name',
        message: 'notifications.background_service_message',
      },
    ]);
  });

  it('keeps background work off until receiving is ready, independently of notification permission', async () => {
    await initService();
    expect(mockEnabledPref).toBe(true);
    expect(mockRegisterCount).toBe(0);
    expect(mockBackgroundMessagingStarts).toEqual([]);
    await setReceiveReady(true);
    expect(mockRegisterCount).toBe(1);
    expect(mockBackgroundMessagingStarts).toHaveLength(1);
  });

  it('stops both background paths and pending notification delivery on a key change', async () => {
    const service = await initService();
    await setReceiveReady(true);
    const pending = service.notifyNewRumors([rumor('old-key')]);
    await drainMicrotasks();
    const stopsBefore = mockBackgroundMessagingStopCount;
    const unregistersBefore = mockUnregisterCount;
    receiveSession().setState({
      status: 'key-required', accountPubkey: 'account-pubkey', encryptionPubkey: 'new-key',
    }, true);
    await pending;
    await flushAggregation();
    expect(mockOps).toEqual([]);
    expect(mockBackgroundMessagingStopCount).toBeGreaterThan(stopsBefore);
    expect(mockUnregisterCount).toBeGreaterThan(unregistersBefore);
    expect(mockEnabledPref).toBe(true);
    const registrations = mockRegisterCount;
    await service.enable();
    expect(mockRegisterCount).toBe(registrations);
    expect(mockBackgroundMessagingStarts).toHaveLength(1);
    await setReceiveReady(true);
    expect(mockRegisterCount).toBe(registrations + 1);
    expect(mockBackgroundMessagingStarts).toHaveLength(2);
  });

  it('suppresses a cold poll result if the key was invalidated before notification initialization', async () => {
    receiveSession().setState({
      status: 'key-required', accountPubkey: 'account-pubkey', encryptionPubkey: 'new-key',
    }, true);
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- intentionally omit init for a cold task
    const { notificationService } = require('../notification.service') as NotificationServiceModule;
    await notificationService.notifyNewRumors([rumor('stale-cold-result')], {
      accountPubkey: 'account-pubkey', flushImmediately: true,
    });
    expect(mockOps).toEqual([]);
    expect(jest.getTimerCount()).toBe(0);
  });

  it('does not start a resident service if a key changes during periodic-task registration', async () => {
    await initService();
    let finishRegister!: () => void;
    mockRegisterBarrier = new Promise<void>((resolve) => { finishRegister = resolve; });
    await setReceiveReady(true);
    expect(mockRegisterCount).toBe(1);
    receiveSession().setState({
      status: 'key-required', accountPubkey: 'account-pubkey', encryptionPubkey: 'new-key',
    }, true);
    finishRegister();
    for (let i = 0; i < 40; i++) await Promise.resolve();
    expect(mockBackgroundMessagingStarts).toEqual([]);
    expect(mockUnregisterCount).toBeGreaterThan(1);
  });

  it('requests a battery-optimization exemption once after notification permission', async () => {
    const service = await initService();

    expect(mockBatteryOptimizationRequestCount).toBe(1);
    expect(mockBatteryOptimizationPrompted).toBe(true);

    await service.disable();
    await service.enable();

    expect(mockBatteryOptimizationRequestCount).toBe(1);
  });

  it('does not request a battery exemption when notification permission is denied', async () => {
    mockPermission = false;

    await initService();

    expect(mockBatteryOptimizationRequestCount).toBe(0);
    expect(mockBatteryOptimizationPrompted).toBe(false);
  });

  it('records an existing battery exemption without opening system settings', async () => {
    mockBatteryOptimizationExempt = true;

    await initService();

    expect(mockBatteryOptimizationRequestCount).toBe(0);
    expect(mockBatteryOptimizationPrompted).toBe(true);
  });

  it('stops background messaging when the account session ends', async () => {
    await initService();
    await setReceiveReady(true);
    const stopsBeforeSessionEnd = mockBackgroundMessagingStopCount;

    await setReceiveReady(false);

    expect(mockBackgroundMessagingStopCount).toBe(stopsBeforeSessionEnd + 1);
  });

  it('aggregates near-simultaneous messages into one OS presentation', async () => {
    await initService();

    mockDmListener!.onNewMessage!(rumor('r1'));
    mockDmListener!.onNewMessage!(rumor('r2'));
    await flushAggregation();

    expect(mockOps).toEqual(['present:notifications.new_messages:2']);
    expect(mockDismissAllCount).toBe(1);
  });

  it('cancels an unflushed aggregate when the user returns', async () => {
    const service = await initService();

    const pending = service.notifyNewRumors([rumor('r1')]);
    await drainMicrotasks();
    mockShouldNotify = false;
    mockUserReturned!();
    await pending;
    await jest.advanceTimersByTimeAsync(1_000);
    await drainMicrotasks();

    expect(mockOps).toEqual([]);
    expect(mockDismissAllCount).toBe(1);
  });

  it('dedups a rumor arriving on both the live and poll paths', async () => {
    const service = await initService();

    mockDmListener!.onNewMessage!(rumor('r1'));
    const poll = service.notifyNewRumors([rumor('r1'), rumor('r2')]);
    await flushAggregation();
    await poll;

    expect(mockOps).toEqual(['present:notifications.new_messages:2']);
  });

  it('never notifies for a message request (hasReplied = false)', async () => {
    mockFilterAllows = false;
    const service = await initService();

    await service.notifyNewRumors([rumor('r1')]);

    expect(mockOps).toEqual([]);
  });

  it('never notifies for a muted conversation', async () => {
    mockFilterAllows = false;
    const service = await initService();

    await service.notifyNewRumors([rumor('r1')]);

    expect(mockOps).toEqual([]);
  });

  it('stays silent when the eligibility filter rejects a batch', async () => {
    mockFilterAllows = false;
    const service = await initService();

    await service.notifyNewRumors([rumor('r1'), rumor('r2')]);

    expect(mockOps).toEqual([]);
  });

  it('stays silent while the platform gate says the user is present', async () => {
    mockShouldNotify = false;
    const service = await initService();

    await service.notifyNewRumors([rumor('r1')]);

    expect(mockOps).toEqual([]);
  });

  it('stays silent during quiet hours and does not deliver after they end', async () => {
    mockDndActive = true;
    const service = await initService();

    await service.notifyNewRumors([rumor('r1')]);

    expect(mockOps).toEqual([]);

    // The window ends: the suppressed rumor was never queued, so nothing
    // catches up; only messages arriving after the window notify.
    mockDndActive = false;
    await notifyAndFlush(service, [rumor('r2')]);

    expect(mockOps).toEqual(['present:notifications.new_message']);
  });

  it('drops a pending aggregate when quiet hours start inside the window', async () => {
    const service = await initService();
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- access the active per-test mock instance
    const prefs = require('../notification-prefs') as typeof import('../notification-prefs');
    const isDndActiveNow = prefs.isDndActiveNow as jest.Mock;
    isDndActiveNow.mockResolvedValueOnce(false).mockResolvedValue(true);

    await notifyAndFlush(service, [rumor('r1')]);

    expect(mockOps).toEqual([]);
  });

  it('rechecks presence after filtering before presenting', async () => {
    const service = await initService();
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- access the active per-test mock instance
    const { platform } = require('@/platform') as typeof import('@/platform');
    const shouldNotifyNow = platform.notifications.shouldNotifyNow as jest.Mock;
    shouldNotifyNow
      .mockReturnValueOnce(true)
      .mockReturnValueOnce(true)
      .mockReturnValue(false);

    await notifyAndFlush(service, [rumor('r1')]);

    expect(shouldNotifyNow).toHaveBeenCalledTimes(3);
    expect(mockOps).toEqual([]);
  });

  it('resets the tally and dismisses everything when the user returns', async () => {
    const service = await initService();

    await notifyAndFlush(service, [rumor('r1'), rumor('r2')]);
    mockUserReturned!();
    await drainMicrotasks();

    expect(mockDismissAllCount).toBe(2);

    // The count (and the dedup set) reset: a re-delivered r1 counts again.
    await notifyAndFlush(service, [rumor('r1')]);
    expect(mockOps).toEqual([
      'present:notifications.new_messages:2',
      'present:notifications.new_message',
    ]);
  });

  it('flips the preference off when the OS grant was revoked', async () => {
    const service = await initService();
    const unregistersBefore = mockUnregisterCount;
    mockPermission = false;

    await notifyAndFlush(service, [rumor('r1')]);

    expect(mockOps).toEqual([]);
    expect(mockEnabledPref).toBe(false);
    expect(mockUnregisterCount).toBe(unregistersBefore + 1);
  });

  it('keeps notifications enabled after a transient delivery failure', async () => {
    const service = await initService();
    const unregistersBefore = mockUnregisterCount;
    mockPresentSucceeds = false;

    await notifyAndFlush(service, [rumor('r1')]);

    expect(mockEnabledPref).toBe(true);
    expect(mockUnregisterCount).toBe(unregistersBefore);

    mockPresentSucceeds = true;
    await notifyAndFlush(service, [rumor('r2')]);

    expect(mockOps).toEqual([
      'present:notifications.new_message',
      'present:notifications.new_messages:2',
    ]);
  });

  it('stays silent when the preference is disabled', async () => {
    mockEnabledPref = false;
    const service = await initService();

    await service.notifyNewRumors([rumor('r1')]);

    expect(mockOps).toEqual([]);
  });
});
