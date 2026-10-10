import { act, create, type ReactTestRenderer } from 'react-test-renderer';

import type { FileAttachmentMeta } from '@/lib/nostr/file-tags';
import {
  fetchAndDecryptAttachment,
  getCachedAttachmentUri,
  getSessionCachedUri,
} from '@/services/files/file-attachment.service';

import { attachmentDownloadTaskKey, runAttachmentDownload } from '@/services/files/attachment-download-task';
import type { AttachmentFetchOptions } from '@/services/files/file-attachment.service';

import { attachmentDownloadKey, attachmentTransferStore } from '@/services/files/attachment-transfer-state';
import { useAttachmentTransfer } from '@/stores/attachment-transfer.store';

import { useAttachment, type UseAttachment } from '../use-attachment';

jest.mock('@/stores/active-account.store', () => ({
  useActiveAccount: (selector: (state: { activePubkey: string }) => unknown) =>
    selector({ activePubkey: 'account' }),
}));

const mockDownload = jest.fn<Promise<string>, [FileAttachmentMeta, AttachmentFetchOptions]>();

jest.mock('@/services/files/file-attachment.service', () => ({
  attachmentErrorKind: jest.fn(() => 'download'),
  fetchAndDecryptAttachment: jest.fn((meta, options = {}) => {
    const task = jest.requireActual('@/services/files/attachment-download-task');
    return task.runAttachmentDownload(
      task.attachmentDownloadTaskKey(options.accountPubkey ?? null, meta, options.allowIntegrityMismatch),
      options.signal, (signal: AbortSignal) => mockDownload(meta, { ...options, signal }),
    );
  }),
  getCachedAttachmentUri: jest.fn(),
  getSessionCachedUri: jest.fn(),
}));

const META: FileAttachmentMeta = {
  url: 'blossom:example',
  cipherSha256Hex: 'a'.repeat(64),
  decryptionKeyHex: 'b'.repeat(64),
  decryptionNonceHex: 'c'.repeat(24),
};

describe('useAttachment download controls', () => {
  let renderer: ReactTestRenderer | undefined;
  let result: UseAttachment;

  beforeEach(() => {
    attachmentTransferStore.setState({ byKey: {} });
    jest.mocked(getSessionCachedUri).mockReturnValue(null);
    jest.mocked(getCachedAttachmentUri).mockResolvedValue(null);
  });

  afterEach(() => {
    act(() => renderer?.unmount());
    renderer = undefined;
    jest.clearAllMocks();
    mockDownload.mockReset();
  });

  it('checks only local cache until the user explicitly loads a non-contact attachment', async () => {
    mockDownload.mockResolvedValue('/attachments/ready.jpg');
    function Harness() {
      result = useAttachment(META, { autoLoad: false });
      return null;
    }
    await act(async () => { renderer = create(<Harness />); });
    expect(getCachedAttachmentUri).toHaveBeenCalledWith(META);
    expect(fetchAndDecryptAttachment).not.toHaveBeenCalled();
    expect(result!.state.status).toBe('idle');

    await act(async () => { result!.load(); });
    expect(fetchAndDecryptAttachment).toHaveBeenCalledTimes(1);
    expect(result!.state).toEqual({ status: 'ready', localUri: '/attachments/ready.jpg' });
  });

  it('renders cached non-contact attachments without a network request', async () => {
    jest.mocked(getCachedAttachmentUri).mockResolvedValue('/attachments/cached.jpg');
    function Harness() {
      result = useAttachment(META, { autoLoad: false });
      return null;
    }
    await act(async () => { renderer = create(<Harness />); });
    expect(fetchAndDecryptAttachment).not.toHaveBeenCalled();
    expect(result!.state).toEqual({ status: 'ready', localUri: '/attachments/cached.jpg' });
  });

  it('keeps local lookup separate from a missing attachment and never discards a ready URI', async () => {
    let resolve!: (uri: string | null) => void;
    jest.mocked(getCachedAttachmentUri).mockReturnValue(new Promise((done) => { resolve = done; }));
    function Harness({ autoLoad }: { autoLoad: boolean }) {
      result = useAttachment(META, { autoLoad });
      return null;
    }
    act(() => { renderer = create(<Harness autoLoad={false} />); });
    expect(result!.state.status).toBe('checking');
    expect(fetchAndDecryptAttachment).not.toHaveBeenCalled();
    await act(async () => { resolve('/attachments/local.jpg'); });
    expect(result!.state).toEqual({ status: 'ready', localUri: '/attachments/local.jpg' });
    await act(async () => { renderer!.update(<Harness autoLoad />); });
    await act(async () => { renderer!.update(<Harness autoLoad={false} />); });
    expect(result!.state).toEqual({ status: 'ready', localUri: '/attachments/local.jpg' });
    expect(fetchAndDecryptAttachment).not.toHaveBeenCalled();
    expect(getCachedAttachmentUri).toHaveBeenCalledTimes(1);
  });

  it('shares one URL download and its progress across two different messages', async () => {
    let finish!: (uri: string) => void;
    mockDownload.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
    const states: Record<string, UseAttachment> = {};
    const percents: Record<string, number | null> = {};
    function Harness({ id }: { id: string }) {
      states[id] = useAttachment(META);
      percents[id] = useAttachmentTransfer('account', id, META.url)?.percent ?? null;
      return null;
    }
    await act(async () => {
      renderer = create(<><Harness id="first" /><Harness id="second" /></>);
    });
    expect(fetchAndDecryptAttachment).toHaveBeenCalledTimes(1);
    const key = attachmentDownloadKey('account', META.url);
    try {
      await act(async () => { attachmentTransferStore.getState().update(key, 'network', 25, 100); });
      expect(percents).toEqual({ first: 25, second: 25 });
      await act(async () => { attachmentTransferStore.getState().update(key, 'network', 75, 100); });
      expect(percents).toEqual({ first: 75, second: 75 });
      await act(async () => { finish('/attachments/shared.jpg'); });
      expect(states.first.state).toEqual({ status: 'ready', localUri: '/attachments/shared.jpg' });
      expect(states.second.state).toEqual(states.first.state);
    } finally { act(() => attachmentTransferStore.getState().clear(key)); }
  });

  it('does not merge different attachment URLs even when the ciphertext hash matches', async () => {
    mockDownload.mockResolvedValue('/attachments/local.jpg');
    function Harness({ url }: { url: string }) {
      useAttachment({ ...META, url });
      return null;
    }
    await act(async () => {
      renderer = create(<><Harness url="https://first.example/file" /><Harness url="https://second.example/file" /></>);
    });
    expect(fetchAndDecryptAttachment).toHaveBeenCalledTimes(2);
  });

  it('pauses an active fetch and starts a fresh resumable attempt', async () => {
    let resumeDownload: ((uri: string) => void) | undefined;
    mockDownload.mockImplementationOnce((_meta, options) =>
      new Promise((_resolve, reject) => {
        options?.signal?.addEventListener(
          'abort',
          () => {
            const error = new Error('paused');
            error.name = 'AbortError';
            reject(error);
          },
          { once: true },
        );
      }),
    ).mockImplementationOnce(
      () => new Promise((resolve) => {
        resumeDownload = resolve;
      }),
    );

    function Harness() {
      result = useAttachment(META, {
        nearby: { peerPubkey: 'peer', rumorId: 'rumor', tags: [] },
      });
      return null;
    }

    await act(async () => {
      renderer = create(<Harness />);
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(result!.state.status).toBe('loading');

    await act(async () => {
      result!.pause();
      await Promise.resolve();
    });
    expect(result!.state.status).toBe('paused');

    await act(async () => {
      result!.resume();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(fetchAndDecryptAttachment).toHaveBeenCalledTimes(2);
    expect(result!.state.status).toBe('loading');

    await act(async () => {
      resumeDownload?.('/attachments/ready.jpg');
      await Promise.resolve();
    });
    expect(result!.state).toEqual({ status: 'ready', localUri: '/attachments/ready.jpg' });
  });
  it('reconnects paused and deferred consumers when a sibling resumes', async () => {
    let finish!: (uri: string) => void;
    mockDownload.mockImplementationOnce((_meta, options) => new Promise((_resolve, reject) => {
      options.signal?.addEventListener('abort', () => {
        const error = new Error('paused'); error.name = 'AbortError'; reject(error);
      });
    })).mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    const consumers: Record<string, UseAttachment> = {};
    function Harness({ id, autoLoad = true }: { id: string; autoLoad?: boolean }) {
      consumers[id] = useAttachment(META, { autoLoad });
      return null;
    }
    await act(async () => {
      renderer = create(<><Harness id="image" /><Harness id="viewer" /><Harness id="deferred" autoLoad={false} /></>);
    });
    expect(mockDownload).toHaveBeenCalledTimes(1);
    await act(async () => { consumers.image.pause(); });
    expect(Object.values(consumers).map((consumer) => consumer.state.status)).toEqual(['paused', 'paused', 'paused']);
    await act(async () => { consumers.image.resume(); });
    expect(mockDownload).toHaveBeenCalledTimes(2);
    expect(Object.values(consumers).map((consumer) => consumer.state.status)).toEqual(['loading', 'loading', 'loading']);
    await act(async () => { finish('/attachments/resumed.jpg'); });
    for (const consumer of Object.values(consumers)) {
      expect(consumer.state).toEqual({ status: 'ready', localUri: '/attachments/resumed.jpg' });
    }
  });

  it('observes a replacement started outside the hook and ignores late aborted results', async () => {
    let finishOld!: (uri: string) => void;
    let finishNew!: (uri: string) => void;
    mockDownload.mockImplementationOnce(() => new Promise((resolve) => { finishOld = resolve; }));
    function Harness() { result = useAttachment(META); return null; }
    await act(async () => { renderer = create(<Harness />); });
    await act(async () => { result.pause(); });
    const key = attachmentDownloadTaskKey('account', META);
    let replacement!: Promise<string>;
    await act(async () => {
      replacement = runAttachmentDownload(key, undefined, () => new Promise((resolve) => { finishNew = resolve; }));
    });
    expect(result.state.status).toBe('loading');
    await act(async () => { finishOld('/attachments/old.jpg'); });
    expect(result.state.status).toBe('loading');
    await act(async () => { finishNew('/attachments/new.jpg'); await replacement; });
    expect(result.state).toEqual({ status: 'ready', localUri: '/attachments/new.jpg' });
  });

  it('does not publish an integrity override to a sibling that did not approve it', async () => {
    mockDownload.mockRejectedValueOnce(new Error('Integrity mismatch'))
      .mockResolvedValueOnce('/attachments/revealed.jpg');
    const consumers: Record<string, UseAttachment> = {};
    function Harness({ id }: { id: string }) { consumers[id] = useAttachment(META); return null; }
    await act(async () => { renderer = create(<><Harness id="approved" /><Harness id="verified" /></>); });
    expect(consumers.verified.state.status).toBe('error');
    await act(async () => { consumers.approved.reveal(); });
    expect(consumers.approved.state).toEqual({ status: 'ready', localUri: '/attachments/revealed.jpg' });
    expect(consumers.verified.state.status).toBe('error');
    expect(mockDownload).toHaveBeenCalledTimes(2);
  });

});
