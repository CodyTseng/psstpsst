import { AppState } from 'react-native';

import type { LocalNotificationsModule } from '../local-notifications';
import type { NotificationsPort } from '../../ports/notifications';
import type { UnreadIndicatorPort } from '../../ports/unread-indicator';

const mockGetCachePath = jest.fn();
const mockPrefetch = jest.fn();
let mockAppState = 'background';
let mockStateListener: (state: 'active' | 'background') => void;
let mockNative: jest.Mocked<LocalNotificationsModule> | null;
const mockLoadNative = jest.fn(() => mockNative);

jest.mock('expo-modules-core', () => ({
  ...jest.requireActual('expo-modules-core'),
  requireOptionalNativeModule: mockLoadNative,
}));
jest.mock('expo-image', () => ({ Image: { getCachePathAsync: mockGetCachePath, prefetch: mockPrefetch } }));


let notifications: NotificationsPort;
let unreadIndicator: UnreadIndicatorPort;
const content = { title: 'New message', body: 'Hello', badgeCount: 7 };

const originalState = Object.getOwnPropertyDescriptor(AppState, 'currentState')!;
beforeAll(() => {
  Object.defineProperty(AppState, 'currentState', { configurable: true, get: () => mockAppState });
});
afterAll(() => {
  Object.defineProperty(AppState, 'currentState', originalState);
  jest.restoreAllMocks();
});

beforeEach(() => {
  jest.clearAllMocks();
  mockAppState = 'background';
  jest.spyOn(AppState, 'addEventListener').mockImplementation((_, listener) => {
    mockStateListener = listener;
    return { remove: jest.fn() };
  });
  mockNative = {
    hasPermissionAsync: jest.fn(async () => true),
    ensurePermissionAsync: jest.fn<Promise<boolean>, [string]>().mockResolvedValue(true),
    presentAsync: jest.fn<Promise<boolean>, Parameters<LocalNotificationsModule['presentAsync']>>().mockResolvedValue(true),
    dismissAllAsync: jest.fn(async () => {}),
    setBadgeCountAsync: jest.fn<Promise<boolean>, [number]>().mockResolvedValue(true),
  };
  mockGetCachePath.mockResolvedValue(null);
  mockPrefetch.mockResolvedValue(false);
  jest.isolateModules(() => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    notifications = require('../notifications').notificationsAdapter;
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    unreadIndicator = require('../unread-indicator').unreadIndicatorAdapter;
  });
});

it('loads the native capability lazily and tolerates an older native build', async () => {
  expect(mockLoadNative).not.toHaveBeenCalled();
  mockNative = null;
  expect(notifications.isAvailable()).toBe(false);
  await expect(notifications.hasPermission()).resolves.toBe(false);
  await expect(notifications.ensurePermission('Messages')).resolves.toBe(false);
  await expect(notifications.present(content)).resolves.toBe(false);
  await expect(notifications.dismissAll()).resolves.toBeUndefined();
  await expect(unreadIndicator.setCount(2)).resolves.toBe(false);
  expect(mockLoadNative).toHaveBeenCalledTimes(1);
});

it('delegates permission requests with the localized channel name', async () => {
  mockNative!.hasPermissionAsync.mockResolvedValue(false);
  mockNative!.ensurePermissionAsync.mockResolvedValue(false);
  await expect(notifications.hasPermission()).resolves.toBe(false);
  await expect(notifications.ensurePermission('Messages')).resolves.toBe(false);
  expect(mockNative!.ensurePermissionAsync).toHaveBeenCalledWith('Messages');
});

it('posts a private notification without fetching a disabled avatar', async () => {
  await expect(notifications.present(content)).resolves.toBe(true);
  expect(mockGetCachePath).not.toHaveBeenCalled();
  expect(mockNative!.presentAsync).toHaveBeenCalledWith('New message', null, 'Hello', null, 7);
});

it('uses an existing avatar cache without downloading it again', async () => {
  mockGetCachePath.mockResolvedValue('/cache/avatar');
  await notifications.present({ ...content, avatarUrl: 'https://example.com/avatar' });
  expect(mockPrefetch).not.toHaveBeenCalled();
  expect(mockNative!.presentAsync).toHaveBeenCalledWith('New message', null, 'Hello', '/cache/avatar', 7);
});

it('still delivers text when avatar fetching fails', async () => {
  mockGetCachePath.mockRejectedValue(new Error('Image unavailable'));
  await expect(notifications.present({ ...content, avatarUrl: 'https://example.com/avatar' })).resolves.toBe(true);
  expect(mockNative!.presentAsync).toHaveBeenCalledWith('New message', null, 'Hello', null, 7);
});

it.each(['active', 'inactive'])('suppresses delivery while %s', async (state) => {
  mockAppState = state;
  expect(notifications.shouldNotifyNow()).toBe(false);
  await expect(notifications.present(content)).resolves.toBe(true);
  expect(mockNative!.presentAsync).not.toHaveBeenCalled();
});

it('drops an in-flight avatar fetch after account cleanup', async () => {
  let resolveAvatar!: (path: string) => void;
  mockGetCachePath.mockReturnValue(new Promise<string>((resolve) => { resolveAvatar = resolve; }));
  const delivery = notifications.present({ ...content, avatarUrl: 'https://example.com/avatar' });
  await notifications.dismissAll();
  resolveAvatar('/cache/avatar');
  await expect(delivery).resolves.toBe(true);
  expect(mockNative!.presentAsync).not.toHaveBeenCalled();
});

it('drops old delivery even if the app returns and backgrounds during image loading', async () => {
  const listener = jest.fn();
  notifications.addUserReturnedListener(listener);
  let resolveAvatar!: (path: string) => void;
  mockGetCachePath.mockReturnValue(new Promise<string>((resolve) => { resolveAvatar = resolve; }));
  const delivery = notifications.present({ ...content, avatarUrl: 'https://example.com/avatar' });
  mockStateListener('active');
  mockStateListener('background');
  resolveAvatar('/cache/avatar');
  await delivery;
  expect(listener).toHaveBeenCalledTimes(1);
  expect(mockNative!.presentAsync).not.toHaveBeenCalled();
});

it('reports rejected delivery and treats badges and cleanup as best effort', async () => {
  mockNative!.presentAsync.mockResolvedValue(false);
  mockNative!.dismissAllAsync.mockRejectedValue(new Error('Unavailable'));
  mockNative!.setBadgeCountAsync.mockRejectedValue(new Error('Unsupported launcher'));
  await expect(notifications.present(content)).resolves.toBe(false);
  await expect(notifications.dismissAll()).resolves.toBeUndefined();
  await expect(unreadIndicator.setCount(7)).resolves.toBe(false);
});
