import { db } from '@/db/client';
import { usePendingAttachmentsStore, type PendingAttachment } from '../pending-attachments.store';

jest.mock('@/db/client', () => ({ db: { insert: jest.fn() } }));
jest.mock('@/db/schema', () => ({ pendingAttachments: { accountPubkey: 'account', tempId: 'id' } }));
jest.mock('@/services/files/pending-attachment-file.service', () => ({}));

const item: PendingAttachment = {
  accountPubkey: 'account',
  tempId: 'upload',
  conversationKey: 'peer',
  localUri: 'psstpsst-file://documents/clip.mov',
  localName: 'clip.mov',
  mime: 'video/quicktime',
  status: 'uploading',
};
const values = jest.fn();

beforeEach(() => {
  jest.clearAllMocks();
  values.mockReturnValue({ onConflictDoUpdate: jest.fn().mockResolvedValue(undefined) });
  (db.insert as jest.Mock).mockReturnValue({ values });
  usePendingAttachmentsStore.setState({ items: [item, { ...item, tempId: 'other' }] });
});

it('updates and persists the measured dimensions while retaining unrelated row references', async () => {
  const sibling = usePendingAttachmentsStore.getState().items[1];
  usePendingAttachmentsStore.getState().setDimensions('upload', { width: 2056, height: 1576 });
  expect(usePendingAttachmentsStore.getState().items[0]).toMatchObject({ width: 2056, height: 1576 });
  expect(usePendingAttachmentsStore.getState().items[1]).toBe(sibling);
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(values).toHaveBeenCalledWith(expect.objectContaining({ width: 2056, height: 1576 }));
});

it('does not notify subscribers again for unchanged dimensions', () => {
  usePendingAttachmentsStore.getState().setDimensions('upload', { width: 2056, height: 1576 });
  const listener = jest.fn();
  const unsubscribe = usePendingAttachmentsStore.subscribe(listener);
  usePendingAttachmentsStore.getState().setDimensions('upload', { width: 2056, height: 1576 });
  expect(listener).not.toHaveBeenCalled();
  unsubscribe();
});

it('ignores invalid dimensions and callbacks for removed uploads', () => {
  const previous = usePendingAttachmentsStore.getState().items;
  usePendingAttachmentsStore.getState().setDimensions('upload', { width: 0, height: 1576 });
  usePendingAttachmentsStore.getState().setDimensions('removed', { width: 2056, height: 1576 });
  expect(usePendingAttachmentsStore.getState().items).toBe(previous);
});
