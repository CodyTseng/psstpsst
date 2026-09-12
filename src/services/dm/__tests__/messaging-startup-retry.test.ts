import type { AppStateStatus, NetworkStateSnapshot } from '@/platform';

import {
  MessagingMetadataUnavailableError,
  resolveMessagingMetadata,
  type MessagingMetadata,
} from '../messaging-metadata';
import { resolveMessagingMetadataForStartup } from '../messaging-startup-retry';

let mockNetworkListener: ((state: NetworkStateSnapshot) => void) | undefined;
let mockAppState: AppStateStatus = 'active';
const mockAppListeners = new Set<(state: AppStateStatus) => void>();
const mockObserveNetwork = jest.fn((listener: (state: NetworkStateSnapshot) => void) => {
  mockNetworkListener = listener;
});
jest.mock('@/platform', () => ({ platform: {
  appState: {
    currentState: () => mockAppState,
    addChangeListener: (listener: (state: AppStateStatus) => void) => {
      mockAppListeners.add(listener);
      return () => { mockAppListeners.delete(listener); };
    },
  },
  networkState: { addStateListener: (listener: (state: NetworkStateSnapshot) => void) => mockObserveNetwork(listener) },
} }));
jest.mock('../messaging-metadata', () => ({
  resolveMessagingMetadata: jest.fn(),
  MessagingMetadataUnavailableError: class extends Error {},
}));

const metadata: MessagingMetadata = {
  accountPubkey: 'account', dmRelays: [], announcementRelays: [], announcement: null,
};
const resolveMetadata = jest.mocked(resolveMessagingMetadata);
let controller: AbortController;
let warning: jest.SpyInstance;
const signAuth = jest.fn();
const unavailable = () => new MessagingMetadataUnavailableError([]);
async function flush() { for (let i = 0; i < 10; i++) await Promise.resolve(); }
function start() { return resolveMessagingMetadataForStartup('account', { signAuth, abort: controller.signal }); }

beforeEach(() => {
  jest.useFakeTimers();
  controller = new AbortController();
  mockAppState = 'active';
  resolveMetadata.mockReset().mockResolvedValue(metadata);
  warning = jest.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => {
  controller.abort();
  warning.mockRestore();
  jest.useRealTimers();
});

it('retries unavailable metadata with backoff until a fresh query succeeds', async () => {
  resolveMetadata.mockRejectedValueOnce(unavailable()).mockRejectedValueOnce(unavailable());
  const preparing = start();
  await flush();
  expect(resolveMetadata).toHaveBeenCalledTimes(1);
  await jest.advanceTimersByTimeAsync(1_000);
  expect(resolveMetadata).toHaveBeenCalledTimes(2);
  await jest.advanceTimersByTimeAsync(2_000);
  expect(await preparing).toBe(metadata);
  expect(resolveMetadata).toHaveBeenCalledTimes(3);
  expect(warning).toHaveBeenCalledTimes(1);
  expect(mockAppListeners.size).toBe(0);
  expect(jest.getTimerCount()).toBe(0);
});

it('retries immediately when the network recovers', async () => {
  resolveMetadata.mockRejectedValueOnce(unavailable());
  const preparing = start();
  await flush();
  mockNetworkListener!({ isConnected: true, isInternetReachable: true });
  expect(await preparing).toBe(metadata);
  expect(resolveMetadata).toHaveBeenCalledTimes(2);
  expect(jest.getTimerCount()).toBe(0);
  expect(mockObserveNetwork).toHaveBeenCalledTimes(1);
});

it('waits without a background timer and retries when the app becomes active', async () => {
  mockAppState = 'background';
  resolveMetadata.mockRejectedValueOnce(unavailable());
  const preparing = start();
  await flush();
  expect(jest.getTimerCount()).toBe(0);
  for (const listener of [...mockAppListeners]) listener('active');
  expect(await preparing).toBe(metadata);
});

it('cancels pending retries on account teardown', async () => {
  resolveMetadata.mockRejectedValue(unavailable());
  const preparing = start();
  const rejected = expect(preparing).rejects.toThrow('cancelled');
  await flush();
  controller.abort();
  await rejected;
  expect(jest.getTimerCount()).toBe(0);
  expect(mockAppListeners.size).toBe(0);
  mockNetworkListener!({ isConnected: true });
  await flush();
  expect(resolveMetadata).toHaveBeenCalledTimes(1);
});

it('does not retry invalid metadata or database errors', async () => {
  resolveMetadata.mockRejectedValue(new Error('invalid announcement'));
  await expect(start()).rejects.toThrow('invalid announcement');
  expect(jest.getTimerCount()).toBe(0);
  expect(resolveMetadata).toHaveBeenCalledTimes(1);
});
