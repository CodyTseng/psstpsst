import { throwIfAborted } from '@/lib/async/abort';
import type { FileAttachmentMeta } from '@/lib/nostr/file-tags';
import { attachmentDownloadKey } from './attachment-transfer-state';

export type DownloadTask = { controller: AbortController; promise: Promise<string> };
const tasks = new Map<string, DownloadTask>();
const groups = new Map<string, Set<AbortController>>();
const subscribers = new Map<string, Set<(task: DownloadTask) => void>>();

export function attachmentDownloadTaskKey(
  accountPubkey: string | null,
  meta: FileAttachmentMeta,
  allowIntegrityMismatch = false,
): string {
  return JSON.stringify([
    attachmentDownloadKey(accountPubkey, meta.url), meta.cipherSha256Hex, meta.plainSha256Hex,
    meta.decryptionKeyHex, meta.decryptionNonceHex, allowIntegrityMismatch,
  ]);
}

/** Observe current and replacement tasks without initiating a remote request. */
export function subscribeAttachmentDownload(key: string, listener: (task: DownloadTask) => void): () => void {
  const listeners = subscribers.get(key) ?? new Set();
  listeners.add(listener);
  subscribers.set(key, listeners);
  const current = tasks.get(key);
  if (current && !current.controller.signal.aborted) listener(current);
  return () => {
    listeners.delete(listener);
    if (!listeners.size) subscribers.delete(key);
  };
}

export function pauseAttachmentDownload(accountPubkey: string | null, url: string): void {
  pauseDownloadGroup(attachmentDownloadKey(accountPubkey, url));
}

export function pauseDownloadGroup(key: string): void {
  for (const controller of groups.get(key) ?? []) controller.abort();
}

/** All subscribers share one URL task; pausing any subscriber pauses that task. */
export async function runAttachmentDownload(
  key: string,
  signal: AbortSignal | undefined,
  download: (signal: AbortSignal) => Promise<string>,
  groupKey = key,
): Promise<string> {
  throwIfAborted(signal);
  let task = tasks.get(key);
  if (!task || task.controller.signal.aborted) {
    const controller = new AbortController();
    const group = groups.get(groupKey) ?? new Set<AbortController>();
    const promise = download(controller.signal).finally(() => {
      group.delete(controller);
      if (group.size === 0 && groups.get(groupKey) === group) groups.delete(groupKey);
      if (tasks.get(key)?.controller === controller) tasks.delete(key);
    });
    task = { controller, promise };
    group.add(controller);
    groups.set(groupKey, group);
    tasks.set(key, task);
    for (const listener of subscribers.get(key) ?? []) listener(task);
  }
  const controller = task.controller;
  const pause = () => controller.abort();
  signal?.addEventListener('abort', pause, { once: true });
  try {
    const result = await task.promise;
    throwIfAborted(controller.signal);
    return result;
  } finally {
    signal?.removeEventListener('abort', pause);
  }
}
