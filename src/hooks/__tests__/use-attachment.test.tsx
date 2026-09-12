import { act, create, type ReactTestRenderer } from 'react-test-renderer';

import type { FileAttachmentMeta } from '@/lib/nostr/file-tags';
import {
  fetchAndDecryptAttachment,
  getCachedAttachmentUri,
  getSessionCachedUri,
} from '@/services/files/file-attachment.service';

import { useAttachment, type UseAttachment } from '../use-attachment';

jest.mock('@/stores/active-account.store', () => ({
  useActiveAccount: (selector: (state: { activePubkey: string }) => unknown) =>
    selector({ activePubkey: 'account' }),
}));

jest.mock('@/services/files/file-attachment.service', () => ({
  attachmentErrorKind: jest.fn(() => 'download'),
  fetchAndDecryptAttachment: jest.fn(),
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
    jest.mocked(getSessionCachedUri).mockReturnValue(null);
    jest.mocked(getCachedAttachmentUri).mockResolvedValue(null);
  });

  afterEach(() => {
    act(() => renderer?.unmount());
    renderer = undefined;
    jest.clearAllMocks();
  });

  it('checks only local cache until the user explicitly loads a non-contact attachment', async () => {
    jest.mocked(fetchAndDecryptAttachment).mockResolvedValue('/attachments/ready.jpg');
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

  it('pauses an active fetch and starts a fresh resumable attempt', async () => {
    let resumeDownload: ((uri: string) => void) | undefined;
    jest.mocked(fetchAndDecryptAttachment).mockImplementationOnce((_meta, options) =>
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
});
