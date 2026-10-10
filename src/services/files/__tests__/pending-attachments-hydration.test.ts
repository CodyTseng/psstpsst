import { pendingAttachmentsStore, type PendingAttachment } from '../pending-attachments';

const mockRows = jest.fn();
jest.mock('@/db/client', () => ({ db: {
  select: () => ({ from: () => ({ where: () => mockRows() }) }),
  insert: () => ({ values: () => ({ onConflictDoUpdate: async () => {} }) }),
  delete: () => ({ where: async () => {} }),
} }));
jest.mock('@/db/schema', () => ({ pendingAttachments: { accountPubkey: 'account', tempId: 'id' } }));
jest.mock('../pending-attachment-file.service', () => ({
  stagePendingAttachmentFile: async ({ tempId }: { tempId: string }) => ({ localName: tempId, localUri: `file:///pending/${tempId}` }),
  deletePendingAttachmentFile: async () => {}, pendingAttachmentFileExists: async () => true,
  pendingAttachmentUri: async (name: string) => `file:///pending/${name}`,
}));

it('does not restore a new external upload as interrupted while account hydration is still running', async () => {
  let resolveRows!: (rows: unknown[]) => void;
  mockRows.mockReturnValue(new Promise((resolve) => { resolveRows = resolve; }));
  pendingAttachmentsStore.setState({ account: null, loaded: false, items: [] });
  const loading = pendingAttachmentsStore.getState().load('account');
  const item: PendingAttachment = { accountPubkey: 'account', tempId: 'external', conversationKey: 'peer',
    localUri: 'file:///source', mime: 'image/jpeg', status: 'preparing' };
  await pendingAttachmentsStore.getState().enqueue([item]);
  pendingAttachmentsStore.getState().setStatus('external', 'uploading');
  resolveRows([{ ...item, localName: 'external', status: 'preparing' }]);
  await loading;
  expect(pendingAttachmentsStore.getState().items).toEqual([
    expect.objectContaining({ tempId: 'external', status: 'uploading' }),
  ]);
  expect(pendingAttachmentsStore.getState().items[0].error).toBeUndefined();
  expect(pendingAttachmentsStore.getState().loaded).toBe(true);
});
