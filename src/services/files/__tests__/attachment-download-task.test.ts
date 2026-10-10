import { createAbortError } from '@/lib/async/abort';
import { runAttachmentDownload } from '../attachment-download-task';
import { attachmentDownloadKey } from '../attachment-transfer-state';

it('shares one URL task across callers and keeps account and URL boundaries', async () => {
  let finish!: (value: string) => void;
  const download = jest.fn(() => new Promise<string>((resolve) => { finish = resolve; }));
  const key = attachmentDownloadKey('account', 'https://media.example/shared');
  const first = runAttachmentDownload(key, undefined, download);
  const second = runAttachmentDownload(key, undefined, download);
  expect(download).toHaveBeenCalledTimes(1);
  finish('local/shared');
  expect(await Promise.all([first, second])).toEqual(['local/shared', 'local/shared']);
  const other = jest.fn(async () => 'local/other');
  await Promise.all([
    runAttachmentDownload(attachmentDownloadKey('other-account', 'https://media.example/shared'), undefined, other),
    runAttachmentDownload(attachmentDownloadKey('account', 'https://media.example/other'), undefined, other),
  ]);
  expect(other).toHaveBeenCalledTimes(2);
});

it('pauses the shared task when any subscriber aborts and permits a new attempt', async () => {
  const key = attachmentDownloadKey('account', 'https://media.example/pause');
  const controller = new AbortController();
  let taskSignal!: AbortSignal;
  const download = jest.fn((signal: AbortSignal) => new Promise<string>((_resolve, reject) => {
    taskSignal = signal;
    signal.addEventListener('abort', () => reject(createAbortError()), { once: true });
  }));
  const first = runAttachmentDownload(key, undefined, download);
  const second = runAttachmentDownload(key, controller.signal, download);
  controller.abort();
  expect(taskSignal.aborted).toBe(true);
  const outcomes = await Promise.allSettled([first, second]);
  expect(outcomes).toEqual([
    { status: 'rejected', reason: expect.objectContaining({ name: 'AbortError' }) },
    { status: 'rejected', reason: expect.objectContaining({ name: 'AbortError' }) },
  ]);
  const resumed = jest.fn(async () => 'local/resumed');
  expect(await runAttachmentDownload(key, undefined, resumed)).toBe('local/resumed');
  expect(resumed).toHaveBeenCalledTimes(1);
});

it('late cleanup from a paused attempt cannot remove its replacement task', async () => {
  const key = attachmentDownloadKey('account', 'https://media.example/restart');
  const controller = new AbortController();
  let finishOld!: (value: string) => void;
  let finishNew!: (value: string) => void;
  const old = runAttachmentDownload(key, controller.signal, () => new Promise((resolve) => { finishOld = resolve; }));
  controller.abort();
  const download = jest.fn(() => new Promise<string>((resolve) => { finishNew = resolve; }));
  const next = runAttachmentDownload(key, undefined, download);
  finishOld('old');
  await expect(old).rejects.toMatchObject({ name: 'AbortError' });
  const another = runAttachmentDownload(key, undefined, download);
  expect(download).toHaveBeenCalledTimes(1);
  finishNew('new');
  expect(await Promise.all([next, another])).toEqual(['new', 'new']);
});
