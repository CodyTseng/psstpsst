import {
  attachmentTransferKey,
  attachmentTransferStore,
} from '../attachment-transfer-state';

describe('attachment transfer progress', () => {
  const key = attachmentTransferKey('account', 'rumor');

  afterEach(() => attachmentTransferStore.getState().clear(key));

  it('keeps Bluetooth and network representations separate', () => {
    attachmentTransferStore.getState().update(key, 'bluetooth', 50, 100);
    expect(attachmentTransferStore.getState().byKey[key]).toMatchObject({
      source: 'bluetooth',
      percent: 50,
    });

    attachmentTransferStore.getState().update(key, 'network', 10, 200);
    expect(attachmentTransferStore.getState().byKey[key]).toEqual({
      source: 'network',
      receivedBytes: 10,
      totalBytes: 200,
      percent: 5,
    });
  });

  it('does not notify rows when a chunk stays within the same whole percent', () => {
    attachmentTransferStore.getState().update(key, 'bluetooth', 100, 10_000);
    const first = attachmentTransferStore.getState();
    attachmentTransferStore.getState().update(key, 'bluetooth', 150, 10_000);

    expect(attachmentTransferStore.getState()).toBe(first);
  });

  it('never moves an upload backwards when a fallback server restarts at zero', () => {
    attachmentTransferStore.getState().update(key, 'upload', 80, 100);
    const beforeRetry = attachmentTransferStore.getState();

    attachmentTransferStore.getState().update(key, 'upload', 0, 100);

    expect(attachmentTransferStore.getState()).toBe(beforeRetry);
    expect(attachmentTransferStore.getState().byKey[key]?.percent).toBe(80);
  });
});
