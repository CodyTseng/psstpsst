import { reconcileRenderedPendingAttachments } from '../pending-attachment-cleanup';

const sent = { tempId: 'upload', status: 'sent', sentRumorId: 'message' };
const rendered = new Set(['message']);

it('retains a completed upload while its existing menu remains open', () => {
  const remove = jest.fn();
  reconcileRenderedPendingAttachments([sent], rendered, new Set(['upload']), remove);
  expect(remove).not.toHaveBeenCalled();
  // Selecting Copy transfers ownership from the menu to the clipboard job.
  reconcileRenderedPendingAttachments([sent], rendered, new Set(['upload']), remove);
  expect(remove).not.toHaveBeenCalled();
  // Completion releases the staged file even without another message update.
  reconcileRenderedPendingAttachments([sent], rendered, new Set(), remove);
  expect(remove).toHaveBeenCalledWith('upload');
});

it('cleans up unrelated completed uploads while a menu retains its own source', () => {
  const remove = jest.fn();
  reconcileRenderedPendingAttachments([sent, { ...sent, tempId: 'other' }], rendered, new Set(['upload']), remove);
  expect(remove.mock.calls).toEqual([['other']]);
});

it('does not remove an upload until its real message is displayed', () => {
  const remove = jest.fn();
  reconcileRenderedPendingAttachments([sent], new Set(), new Set(), remove);
  reconcileRenderedPendingAttachments([{ ...sent, status: 'uploading' }], rendered, new Set(), remove);
  expect(remove).not.toHaveBeenCalled();
});
