import { useEffect } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';

import { platform } from '@/platform';
import { showToast } from '@/stores/toast.store';
import { useClipboard } from '../use-clipboard';

jest.mock('@/platform', () => ({ platform: { clipboard: {
  writeText: jest.fn(), readText: jest.fn(),
} } }));
jest.mock('@/stores/toast.store', () => ({ showToast: jest.fn() }));
const mockTranslate = (key: string) => key;
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: mockTranslate }) }));

let renderer: ReactTestRenderer;
let clipboard: ReturnType<typeof useClipboard>;
function Harness({ trackCopied = true }: { trackCopied?: boolean }) {
  const actions = useClipboard({ trackCopied });
  useEffect(() => { clipboard = actions; });
  return null;
}

beforeEach(() => {
  jest.useFakeTimers({ doNotFake: ['nextTick', 'queueMicrotask', 'setImmediate'] });
  jest.resetAllMocks();
  jest.mocked(platform.clipboard.writeText).mockResolvedValue(undefined);
  jest.mocked(platform.clipboard.readText).mockResolvedValue('invoice');
  act(() => { renderer = create(<Harness />); });
});
afterEach(() => {
  act(() => renderer.unmount());
  jest.clearAllTimers();
  jest.useRealTimers();
});

async function copy(text: string, key?: string) {
  let success!: boolean;
  await act(async () => { success = await clipboard.copyText(text, key); });
  return success;
}

it('reports success only after the platform finishes writing', async () => {
  let finish!: () => void;
  jest.mocked(platform.clipboard.writeText).mockReturnValue(new Promise((resolve) => { finish = resolve; }));
  const settled = jest.fn();
  const copying = clipboard.copyText('event JSON').then(settled);
  await Promise.resolve();
  expect(settled).not.toHaveBeenCalled();
  await act(async () => {
    finish();
    await copying;
  });
  expect(settled).toHaveBeenCalledWith(true);
  expect(platform.clipboard.writeText).toHaveBeenCalledWith('event JSON');
  expect(showToast).not.toHaveBeenCalled();
  expect(clipboard.copied).toBe(true);
});

it.each(['synchronous', 'asynchronous'])('handles %s copy failures without false success', async (failure) => {
  const error = new Error('Clipboard unavailable');
  if (failure === 'synchronous') {
    jest.mocked(platform.clipboard.writeText).mockImplementation(() => { throw error; });
  } else {
    jest.mocked(platform.clipboard.writeText).mockRejectedValue(error);
  }
  await expect(copy('private key')).resolves.toBe(false);
  expect(clipboard.copied).toBe(false);
  expect(showToast).toHaveBeenCalledTimes(1);
  expect(showToast).toHaveBeenCalledWith('common.copy_failed');
});

it('distinguishes an empty clipboard from a failed read', async () => {
  jest.mocked(platform.clipboard.readText).mockResolvedValue('');
  await expect(clipboard.readText()).resolves.toBe('');
  expect(showToast).not.toHaveBeenCalled();
  jest.mocked(platform.clipboard.readText).mockRejectedValue(new Error('Permission denied'));
  await expect(clipboard.readText()).resolves.toBeNull();
  expect(showToast).toHaveBeenCalledWith('common.paste_failed');
});

it('allows retrying after a failed copy', async () => {
  jest.mocked(platform.clipboard.writeText).mockRejectedValueOnce(new Error('Clipboard busy'));
  await expect(copy('invoice')).resolves.toBe(false);
  await expect(copy('invoice')).resolves.toBe(true);
  expect(showToast).toHaveBeenCalledTimes(1);
});

it('clears copied feedback after two seconds and restarts the timer on each copy', async () => {
  await copy('invoice');
  act(() => { jest.advanceTimersByTime(1_500); });
  await copy('invoice');
  act(() => { jest.advanceTimersByTime(1_500); });
  expect(clipboard.copied).toBe(true);
  expect(jest.getTimerCount()).toBe(1);
  act(() => { jest.advanceTimersByTime(500); });
  expect(clipboard.copied).toBe(false);
});

it('tracks the latest copied field and clears stale confirmation on failure', async () => {
  await copy('public key', 'npub');
  expect(clipboard.copiedKey).toBe('npub');
  await copy('payment hash', 'payment_hash');
  expect(clipboard.copiedKey).toBe('payment_hash');
  jest.mocked(platform.clipboard.writeText).mockRejectedValueOnce(new Error('Clipboard busy'));
  await copy('invoice', 'invoice');
  expect(clipboard.copied).toBe(false);
  expect(clipboard.copiedKey).toBeNull();
  expect(jest.getTimerCount()).toBe(0);
});

it('invalidates in-flight feedback when reset or replaced by a newer copy', async () => {
  let finish!: () => void;
  jest.mocked(platform.clipboard.writeText).mockReturnValueOnce(new Promise((resolve) => { finish = resolve; }));
  const oldCopy = clipboard.copyText('old', 'old');
  await copy('new', 'new');
  await act(async () => { finish(); await oldCopy; });
  expect(clipboard.copiedKey).toBe('new');
  act(() => { clipboard.resetCopied(); });
  expect(clipboard.copied).toBe(false);
  expect(jest.getTimerCount()).toBe(0);

  jest.mocked(platform.clipboard.writeText).mockReturnValueOnce(new Promise((resolve) => { finish = resolve; }));
  const resetCopy = clipboard.copyText('reset');
  act(() => { clipboard.resetCopied(); });
  await act(async () => { finish(); await resetCopy; });
  expect(clipboard.copied).toBe(false);
  expect(jest.getTimerCount()).toBe(0);
});

it('cleans up timers and ignores copy completions after unmount', async () => {
  await copy('invoice');
  let finish!: () => void;
  jest.mocked(platform.clipboard.writeText).mockReturnValueOnce(new Promise((resolve) => { finish = resolve; }));
  const pending = clipboard.copyText('pending');
  act(() => { renderer.unmount(); });
  expect(jest.getTimerCount()).toBe(0);
  await act(async () => { finish(); await pending; });
  expect(jest.getTimerCount()).toBe(0);
});

it('can skip feedback state for actions that do not display a copied indicator', async () => {
  act(() => { renderer.update(<Harness trackCopied={false} />); });
  await expect(copy('chat message')).resolves.toBe(true);
  expect(clipboard.copied).toBe(false);
  expect(jest.getTimerCount()).toBe(0);
});
