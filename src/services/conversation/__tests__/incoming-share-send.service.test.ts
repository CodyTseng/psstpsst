import { prepareIncomingShareSend } from '../incoming-share-send.service';
import { conversationSendService } from '../conversation-send.service';
import { buildSigner } from '@/services/account/account.service';
import { pendingAttachmentsStore, retainPendingAttachmentPresentation } from '@/services/files/pending-attachments';
import { pendingAttachmentSendService } from '@/services/files/pending-attachment-send.service';
import { stagePendingAttachmentFile, deletePendingAttachmentFile } from '@/services/files/pending-attachment-file.service';
import { attachmentTransferKey, attachmentTransferStore } from '@/services/files/attachment-transfer-state';
import type { IncomingShareItem } from '@/lib/share/incoming-share';

jest.mock('@/services/account/account.service', () => ({ buildSigner: jest.fn(async () => ({})) }));
jest.mock('../conversation-send.service', () => ({ conversationSendService: { sendFile: jest.fn(), sendMessage: jest.fn() } }));
jest.mock('@/services/proximity/proximity.service', () => ({ proximityService: { recoverConnection: jest.fn(async () => {}) } }));
jest.mock('@/services/files/nearby-file-upload.service', () => ({ nearbyFileUploadService: { pause: jest.fn(), discard: jest.fn(async () => {}) } }));
jest.mock('@/db/client', () => ({ db: {
  insert: () => ({ values: () => ({ onConflictDoUpdate: async () => {} }) }),
  delete: () => ({ where: async () => {} }),
} }));
jest.mock('@/db/schema', () => ({ pendingAttachments: { accountPubkey: 'account', tempId: 'id' } }));
jest.mock('@/services/files/pending-attachment-file.service', () => ({
  stagePendingAttachmentFile: jest.fn(), deletePendingAttachmentFile: jest.fn(async () => {}),
}));

const target = { conversationKey: 'peer', deliveryKind: 'relay' as const, name: 'Peer' };
const mockFile = conversationSendService.sendFile as jest.Mock;
const mockStage = stagePendingAttachmentFile as jest.Mock;
const mockDeletePendingFile = deletePendingAttachmentFile as jest.Mock;
const presentationLeases: (() => void)[] = [];
type SendOptions = Parameters<typeof conversationSendService.sendFile>[0];
function file(mime = 'image/jpeg'): IncomingShareItem {
  return { kind: 'file', id: 'file', localUri: 'file:///share/source', mime, name: 'source', size: 500 };
}

beforeEach(() => {
  jest.clearAllMocks();
  pendingAttachmentsStore.setState({ items: [], account: 'account', loaded: true });
  attachmentTransferStore.setState({ byKey: {} });
  pendingAttachmentSendService.controllers.clear();
  pendingAttachmentSendService.nearbyUploadKeys.clear();
  pendingAttachmentSendService.committedUploadKeys.clear();
  pendingAttachmentSendService.preparedFiles.clear();
  pendingAttachmentSendService.staging.clear();
  mockStage.mockImplementation(async ({ tempId }) => ({ localName: tempId, localUri: `file:///pending/${tempId}` }));
  mockFile.mockImplementation(async (opts: SendOptions) => {
    await opts.onLocalFileReady?.({ uri: 'file:///permanent/source', mime: opts.mime ?? 'application/octet-stream' });
    for (const target of opts.targets) {
      opts.onTargetPublishing?.(target);
      opts.onTargetStored?.(target, `rumor-${target.conversationKey}`);
    }
    return { rumorIds: opts.targets.map((target) => `rumor-${target.conversationKey}`) };
  });
});

afterEach(() => {
  for (const release of presentationLeases.splice(0)) release();
});

it.each(['image/jpeg', 'video/mp4', 'application/pdf'])('shows a pending %s bubble before upload and removes it on unopened-chat success', async (mime) => {
  let finishStage!: (value: unknown) => void;
  mockStage.mockImplementation(() => new Promise((resolve) => { finishStage = resolve; }));
  const task = prepareIncomingShareSend('account', [target], [file(mime)]);
  const item = pendingAttachmentsStore.getState().items[0];
  expect(item).toMatchObject({ conversationKey: 'peer', mime, status: 'preparing', size: 500 });
  expect(attachmentTransferStore.getState().byKey[attachmentTransferKey('account', item.tempId)]?.percent).toBe(5);
  expect(buildSigner).not.toHaveBeenCalled();
  const running = task.run();
  expect(mockFile).not.toHaveBeenCalled();
  finishStage({ localName: item.tempId, localUri: `file:///pending/${item.tempId}` });
  await running;
  expect(mockFile).toHaveBeenCalledWith(expect.objectContaining({
    localUri: 'file:///share/source', mime, targets: [target],
    imageQuality: mime.startsWith('image/') ? 'optimized' : undefined,
  }));
  expect(pendingAttachmentsStore.getState().items).toEqual([]);
  expect(mockDeletePendingFile).toHaveBeenCalledWith(item.tempId, true);
});

it('retains a visible-chat handoff on the permanent mirror while cleaning its staging file', async () => {
  presentationLeases.push(retainPendingAttachmentPresentation('account', 'peer'));
  const warmCache = jest.fn(async () => {});
  mockFile.mockImplementation(async (opts: SendOptions) => {
    opts.onStep?.('encrypting');
    expect(pendingAttachmentsStore.getState().items[0].status).toBe('encrypting');
    opts.onUploadProgress?.(50, 100);
    const item = pendingAttachmentsStore.getState().items[0];
    expect(attachmentTransferStore.getState().byKey[attachmentTransferKey('account', item.tempId)]?.percent).toBe(59);
    opts.onMediaDimensions?.({ width: 800, height: 600 });
    opts.onUploadReady?.({ url: 'https://files.test/image' });
    opts.onTargetPublishing?.(target);
    expect(pendingAttachmentsStore.getState().items[0].status).toBe('publishing');
    await opts.onLocalFileReady?.({ uri: 'file:///permanent/image', mime: 'image/jpeg' });
    opts.onTargetStored?.(target, 'rumor');
    return { rumorIds: ['rumor'] };
  });
  const task = prepareIncomingShareSend('account', [target], [file()], warmCache);
  const tempId = pendingAttachmentsStore.getState().items[0].tempId;
  expect(await task.run()).toBe(false);
  expect(warmCache).toHaveBeenCalledWith({ uri: 'file:///permanent/image', mime: 'image/jpeg' });
  expect(mockDeletePendingFile).toHaveBeenCalledWith(tempId, true);
  expect(pendingAttachmentsStore.getState().items[0]).toMatchObject({
    status: 'sent', sentRumorId: 'rumor', width: 800, height: 600, uploadedUrl: 'https://files.test/image',
    localUri: 'file:///permanent/image', localName: undefined,
  });
});

it('uploads once, removes an unopened successful target, and retains a failed target', async () => {
  const other = { ...target, conversationKey: 'other' };
  mockFile.mockImplementation(async (opts: SendOptions) => {
    opts.onTargetStored?.(target, 'stored');
    throw new Error('Other target failed');
  });
  const task = prepareIncomingShareSend('account', [target, other], [file()]);
  expect(pendingAttachmentsStore.getState().items).toHaveLength(2);
  expect(await task.run()).toBe(true);
  expect(mockFile).toHaveBeenCalledTimes(1);
  expect(pendingAttachmentsStore.getState().items.map((item) => [item.conversationKey, item.status]))
    .toEqual([['other', 'failed']]);
});

it('keeps a failed upload retryable and releases the temporary share only after durable staging', async () => {
  mockFile.mockRejectedValue(new Error('Network unavailable'));
  const cleanup = jest.fn(async () => {});
  const task = prepareIncomingShareSend('account', [target], [file()]);
  expect(await task.run()).toBe(true);
  task.releaseSource(cleanup);
  expect(cleanup).toHaveBeenCalledTimes(1);
  expect(pendingAttachmentsStore.getState().items[0]).toMatchObject({ status: 'failed', localName: expect.any(String) });
});

it('retains the fallback share source until its unstaged pending bubble is removed', async () => {
  mockStage.mockRejectedValue(new Error('Persistent storage unavailable'));
  mockFile.mockRejectedValue(new Error('Network unavailable'));
  const cleanup = jest.fn(async () => {});
  const task = prepareIncomingShareSend('account', [target], [file()]);
  await task.run();
  task.releaseSource(cleanup);
  expect(cleanup).not.toHaveBeenCalled();
  pendingAttachmentsStore.getState().removeOne(pendingAttachmentsStore.getState().items[0].tempId);
  expect(cleanup).toHaveBeenCalledTimes(1);
});

it('allows one target to pause without aborting the shared upload or sending to that target', async () => {
  const other = { ...target, conversationKey: 'other' };
  mockFile.mockImplementation(async (opts: SendOptions) => {
    const peer = pendingAttachmentsStore.getState().items[0];
    pendingAttachmentSendService.pause(peer.tempId);
    expect(opts.signal?.aborted).toBe(false);
    expect(opts.shouldSendTarget?.(target)).toBe(false);
    expect(opts.shouldSendTarget?.(other)).toBe(true);
    opts.onTargetStored?.(other, 'other-rumor');
    return { rumorIds: ['other-rumor'] };
  });
  await prepareIncomingShareSend('account', [target, other], [file()]).run();
  expect(pendingAttachmentsStore.getState().items.map((item) => item.status)).toEqual(['paused']);
  expect(pendingAttachmentsStore.getState().items[0].conversationKey).toBe('peer');
});

it('aborts the upload when its only pending bubble is discarded', async () => {
  mockFile.mockImplementation(async (opts: SendOptions) => {
    pendingAttachmentSendService.cancel(pendingAttachmentsStore.getState().items[0].tempId);
    expect(opts.signal?.aborted).toBe(true);
    const error = new Error('Aborted'); error.name = 'AbortError'; throw error;
  });
  expect(await prepareIncomingShareSend('account', [target], [file()]).run()).toBe(false);
  expect(pendingAttachmentsStore.getState().items).toHaveLength(0);
});

it('cancels only the chosen recipient in a shared file upload', async () => {
  const other = { ...target, conversationKey: 'other' };
  mockFile.mockImplementation(async (opts: SendOptions) => {
    pendingAttachmentSendService.cancel(pendingAttachmentsStore.getState().items[0].tempId);
    expect(opts.signal?.aborted).toBe(false);
    expect(opts.shouldSendTarget?.(target)).toBe(false);
    expect(opts.shouldSendTarget?.(other)).toBe(true);
    opts.onTargetStored?.(other, 'other-rumor');
    return { rumorIds: ['other-rumor'] };
  });
  await prepareIncomingShareSend('account', [target, other], [file()]).run();
  expect(pendingAttachmentsStore.getState().items).toEqual([]);
});
