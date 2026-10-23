import { EventEmitter } from 'node:events';
import { BrowserWindow, ipcMain, type IpcMainInvokeEvent } from 'electron';
import { IPC } from '../ipc-channels';
import { fetchNappletResource, fetchNappletResourceResponse } from '../napplet-resource';
import { registerNappletHandlers } from '../napplet-service';

jest.mock('electron', () => ({
  BrowserWindow: { fromWebContents: jest.fn() },
  ipcMain: { handle: jest.fn(), on: jest.fn() },
}));
jest.mock('../napplet-resource', () => ({ fetchNappletResource: jest.fn(), fetchNappletResourceResponse: jest.fn() }));

let owner: EventEmitter;
let invoke: (channel: string, ...args: unknown[]) => Promise<unknown>;

beforeEach(() => {
  jest.clearAllMocks();
  owner = new EventEmitter();
  jest.mocked(BrowserWindow.fromWebContents).mockReturnValue(owner as BrowserWindow);
  registerNappletHandlers(() => true, () => null);
  invoke = async (channel, ...args) => {
    const handler = jest.mocked(ipcMain.handle).mock.calls.find(([name]) => name === channel)![1];
    return handler({ sender: {} } as IpcMainInvokeEvent, ...args);
  };
});

function pendingFetch() {
  jest.mocked(fetchNappletResource).mockImplementation((_url, _max, signal) => new Promise((_resolve, reject) => {
    signal!.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { code: 'ABORT_ERR' })), { once: true });
  }));
  return invoke(IPC.nappletFetch, 'request', 'https://public.example/asset', 1024);
}

it('settles window-close cancellation without rejecting the IPC handler', async () => {
  const result = pendingFetch();
  owner.emit('closed');
  await expect(result).resolves.toBeNull();
  expect(owner.listenerCount('closed')).toBe(0);
});

it('carries conditional response metadata through the existing owner-scoped IPC handler', async () => {
  jest.mocked(fetchNappletResourceResponse).mockResolvedValue({ status: 304, bytes: new Uint8Array(), etag: '"Tag"' });
  await expect(invoke(IPC.nappletFetch, 'request', 'https://public.example/icon', 1024, undefined, { validators: { etag: '"Tag"' } }))
    .resolves.toEqual({ status: 304, bytes: '', etag: '"Tag"' });
  expect(fetchNappletResourceResponse).toHaveBeenCalledWith('https://public.example/icon', 1024, expect.anything(), { etag: '"Tag"' });
  expect(owner.listenerCount('closed')).toBe(0);
});

it('settles explicit cancellation and releases the request ID', async () => {
  const result = pendingFetch();
  await invoke(IPC.nappletCancel, 'request');
  await expect(result).resolves.toBeNull();
  expect(owner.listenerCount('closed')).toBe(0);
  jest.mocked(fetchNappletResource).mockResolvedValue(new Uint8Array([1, 2, 3]));
  await expect(invoke(IPC.nappletFetch, 'request', 'https://public.example/asset', 1024)).resolves.toBe('AQID');
});

it.each(['timeout', 'blocked-by-policy', 'resource-unavailable'])('preserves genuine fetch failures: %s', async message => {
  jest.mocked(fetchNappletResource).mockRejectedValue(new Error(message));
  await expect(invoke(IPC.nappletFetch, 'request', 'https://public.example/asset', 1024)).resolves.toEqual({ error: message });
  expect(owner.listenerCount('closed')).toBe(0);
});

it('returns aggregate connection failures without rejecting the IPC handler', async () => {
  const error = Object.assign(new AggregateError([
    Object.assign(new Error('connect ETIMEDOUT'), { code: 'ETIMEDOUT' }),
    Object.assign(new Error('connect EHOSTUNREACH'), { code: 'EHOSTUNREACH' }),
  ]), { code: 'ETIMEDOUT' });
  jest.mocked(fetchNappletResource).mockRejectedValue(error);
  await expect(invoke(IPC.nappletFetch, 'request', 'https://public.example/asset', 1024))
    .resolves.toEqual({ error: 'ETIMEDOUT', code: 'ETIMEDOUT' });
  expect(owner.listenerCount('closed')).toBe(0);
});
