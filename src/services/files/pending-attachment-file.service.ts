import { platform } from '@/platform';

import { extFromName, mimeToExt } from './attachment-store';

const DIR_NAME = 'psstpsst-pending-uploads';

async function pendingDir(): Promise<string> {
  const base = await platform.fileSystem.documentDirectoryUri();
  if (!base) throw new Error('FileSystem.documentDirectory unavailable');
  return `${base}${DIR_NAME}/`;
}

export async function pendingAttachmentUri(localName: string): Promise<string> {
  return `${await pendingDir()}${localName}`;
}

export async function stagePendingAttachmentFile(opts: {
  tempId: string;
  sourceUri: string;
  mime: string;
  originalName?: string;
}): Promise<{ localName: string; localUri: string }> {
  const namedExt = extFromName(opts.originalName);
  const ext = namedExt ? `.${namedExt}` : mimeToExt(opts.mime);
  const localName = `${opts.tempId}${ext}`;
  const localUri = await pendingAttachmentUri(localName);
  await platform.fileSystem
    .makeDirectory(await pendingDir(), { intermediates: true })
    .catch(() => {});
  await platform.fileSystem.delete(localUri, { idempotent: true }).catch(() => {});
  await platform.fileSystem.copy(opts.sourceUri, localUri);
  return { localName, localUri };
}

export async function pendingAttachmentFileExists(localName: string): Promise<boolean> {
  const info = await platform.fileSystem.stat(await pendingAttachmentUri(localName));
  return !!(info.exists && info.size && info.size > 0);
}

export async function deletePendingAttachmentFile(localName?: string): Promise<void> {
  if (!localName) return;
  await platform.fileSystem
    .delete(await pendingAttachmentUri(localName), { idempotent: true })
    .catch(() => {});
}
