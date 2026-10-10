import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { useVideoPlayer, VideoView } from 'expo-video';
import { InteractivePressable } from '@/components/common/InteractivePressable';
import { copyForShare } from '@/services/files/file-attachment.service';
import type { ConversationMediaItem } from '@/hooks/use-conversation-media';
import { MediaVideoPage } from '../MediaVideoPage';
import { StyleSheet } from 'react-native';
import { AppButton } from '@/components/common/AppButton';
import { AppText } from '@/components/common/AppText';
import * as Sharing from 'expo-sharing';

let mockCached: string | null = null;
let mockReleased = false;
let mockStatus = 'readyToPlay';
let mockElectron = false;
const mockPlayer = {
  replaceAsync: jest.fn(), play: jest.fn(), loop: false, status: 'readyToPlay',
  release: jest.fn(() => { mockReleased = true; }),
  pause: jest.fn(() => { if (mockReleased) throw new Error('Native player already released'); }),
};
jest.mock('expo-video', () => ({
  useVideoPlayer: jest.fn(() => {
    const React = jest.requireActual('react') as typeof import('react');
    React.useEffect(() => () => mockPlayer.release(), []);
    return mockPlayer;
  }), VideoView: () => null,
}));
jest.mock('expo', () => ({ useEvent: () => ({ status: mockStatus }) }));
jest.mock('../MediaPlaybackControls', () => ({ MediaPlaybackControls: () => null }));
jest.mock('expo-sharing', () => ({ isAvailableAsync: jest.fn(), shareAsync: jest.fn() }));
jest.mock('@/lib/platform', () => ({ get IS_ELECTRON() { return mockElectron; } }));
jest.mock('@/platform', () => ({ platform: { screenOrientation: { setVideoActive: jest.fn().mockResolvedValue(undefined) }, confirmationDialog: { notify: jest.fn() } } }));
jest.mock('expo-image', () => ({ Image: () => null }));
jest.mock('@/components/common/AppButton', () => ({ AppButton: () => null }));
const mockFetchVideo = jest.fn();

jest.mock('@/services/files/file-attachment.service', () => ({
  fetchAndDecryptAttachment: jest.fn((meta, options = {}) => {
    const task = jest.requireActual('@/services/files/attachment-download-task');
    return task.runAttachmentDownload(
      task.attachmentDownloadTaskKey(options.accountPubkey ?? null, meta, options.allowIntegrityMismatch),
      options.signal, () => mockFetchVideo(meta, options),
    );
  }),
  getSessionCachedUri: jest.fn(() => mockCached),
  getCachedAttachmentUri: jest.fn(async () => mockCached),
  attachmentErrorKind: (error: { kind?: string }) => error.kind ?? 'download',
  copyForShare: jest.fn(),
}));
jest.mock('@/stores/active-account.store', () => ({ useActiveAccount: () => 'account' }));
jest.mock('@/components/common/InteractivePressable', () => ({
  InteractivePressable: jest.requireActual('react-native').View,
}));
jest.mock('@/components/chat/AttachmentFailure', () => ({ AttachmentFailure: () => null }));
jest.mock('@/lib/attachments/failure', () => ({
  revealOrRetry: (_kind: unknown, _t: unknown, _action: string, retry: (allow: boolean) => void) => retry(false),
}));
jest.mock('@solar-icons/react-native/category/video/Linear/Play', () => ({ Play: () => null }), { virtual: true });
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
let mockThemePreference: 'light' | 'dark' = 'light';
jest.mock('@/stores/theme.store', () => ({
  useThemeStore: (selector: (value: { accent: 'blue'; preference: 'light' | 'dark' }) => unknown) =>
    selector({ accent: 'blue', preference: mockThemePreference }),
}));

const attachment: ConversationMediaItem = {
  source: 'attachment', isVideo: true, mediaKey: 'video', messageId: 'message', createdAt: 1, orderAt: 1,
  meta: { url: 'https://remote.example/video', mime: 'video/mp4', cipherSha256Hex: 'a'.repeat(64),
    decryptionKeyHex: 'b'.repeat(64), decryptionNonceHex: 'c'.repeat(24) },
};
const remote: ConversationMediaItem = {
  ...attachment, source: 'embedded', meta: { url: 'https://remote.example/video.mp4', kind: 'video' },
};
let renderer: ReactTestRenderer;
const fetchVideo = mockFetchVideo;

beforeEach(() => {
  jest.clearAllMocks();
  mockCached = null;
  mockReleased = false;
  mockStatus = 'readyToPlay';
  mockElectron = false;
  mockThemePreference = 'light';
  mockPlayer.replaceAsync.mockResolvedValue(undefined);
  fetchVideo.mockResolvedValue('file:///downloaded.mp4');
  jest.mocked(Sharing.isAvailableAsync).mockResolvedValue(true);
  jest.mocked(Sharing.shareAsync).mockResolvedValue(undefined);
  jest.mocked(copyForShare).mockResolvedValue('file:///share-copy.mp4');
});
afterEach(() => act(() => renderer?.unmount()));

it.each([
  ['light', false], ['dark', false], ['light', true], ['dark', true],
] as const)('downloads and plays the selected attachment without a second tap in %s mode (Electron=%s)', async (scheme, electron) => {
  mockThemePreference = scheme;
  mockElectron = electron;
  await act(async () => { renderer = create(<MediaVideoPage item={attachment} active />); });
  expect(fetchVideo).toHaveBeenCalledTimes(1);
  expect(mockPlayer.replaceAsync).toHaveBeenCalledWith('file:///downloaded.mp4');
  expect(mockPlayer.play).toHaveBeenCalledTimes(1);
  expect(renderer.root.findByType(VideoView).props.nativeControls).toBe(electron);
  expect(StyleSheet.flatten(renderer.root.findByType(VideoView).props.style))
    .toMatchObject({ width: '100%', height: '100%' });
  expect(renderer.root.findByType(VideoView).props.fullscreenOptions).toEqual({ enable: electron });
});

it('plays an already-cached video without downloading it', async () => {
  mockCached = 'file:///cached.mp4';
  await act(async () => { renderer = create(<MediaVideoPage item={attachment} active />); });
  expect(fetchVideo).not.toHaveBeenCalled();
  expect(mockPlayer.replaceAsync).toHaveBeenCalledWith(mockCached);
  expect(mockPlayer.play).toHaveBeenCalledTimes(1);
});

it('loads and plays a direct video URL on selection', async () => {
  await act(async () => { renderer = create(<MediaVideoPage item={remote} active />); });
  expect(mockPlayer.replaceAsync).toHaveBeenCalledWith({ uri: remote.meta.url, useCaching: true });
  expect(mockPlayer.play).toHaveBeenCalledTimes(1);
});

it.each([attachment, remote])('does not download or mount a player for an unselected %s page', async (item) => {
  await act(async () => { renderer = create(<MediaVideoPage item={item} active={false} />); });
  expect(fetchVideo).not.toHaveBeenCalled();
  expect(useVideoPlayer).not.toHaveBeenCalled();
});

it('lets native release dispose playback without pausing an already released object', async () => {
  mockCached = 'file:///cached.mp4';
  await act(async () => { renderer = create(<MediaVideoPage item={attachment} active />); });
  act(() => renderer.update(<MediaVideoPage item={attachment} active={false} />));
  expect(mockPlayer.release).toHaveBeenCalledTimes(1);
  expect(mockPlayer.pause).not.toHaveBeenCalled();
  expect(renderer.root.findAllByType(VideoView)).toHaveLength(0);
});

it('does not start off-screen playback if a download finishes after swiping away', async () => {
  let finish!: (uri: string) => void;
  fetchVideo.mockImplementation(() => new Promise<string>((resolve) => { finish = resolve; }));
  await act(async () => { renderer = create(<MediaVideoPage item={attachment} active />); });
  act(() => renderer.update(<MediaVideoPage item={attachment} active={false} />));
  await act(async () => { finish('file:///late.mp4'); });
  expect(useVideoPlayer).not.toHaveBeenCalled();
  expect(mockPlayer.play).not.toHaveBeenCalled();
});

it('does not autoplay if asynchronous player loading finishes after leaving the page', async () => {
  let finish!: () => void;
  mockPlayer.replaceAsync.mockImplementation(() => new Promise<void>((resolve) => { finish = resolve; }));
  mockCached = 'file:///cached.mp4';
  await act(async () => { renderer = create(<MediaVideoPage item={attachment} active />); });
  act(() => renderer.update(<MediaVideoPage item={attachment} active={false} />));
  await act(async () => { finish(); });
  expect(mockPlayer.play).not.toHaveBeenCalled();
});

it('keeps a failed download retryable instead of automatically looping', async () => {
  fetchVideo.mockRejectedValueOnce(new Error('Unavailable'));
  await act(async () => { renderer = create(<MediaVideoPage item={attachment} active />); });
  expect(fetchVideo).toHaveBeenCalledTimes(1);
  fetchVideo.mockResolvedValue('file:///retry.mp4');
  await act(async () => { renderer.root.findByType(InteractivePressable).props.onPress(); });
  expect(fetchVideo).toHaveBeenCalledTimes(2);
  expect(mockPlayer.play).toHaveBeenCalledTimes(1);
});

it.each(['light', 'dark'] as const)('shows an inert desktop unsupported status on a native status error in %s mode', async (scheme) => {
  mockElectron = true;
  mockThemePreference = scheme;
  mockCached = 'file:///cached.mp4';
  await act(async () => { renderer = create(<MediaVideoPage item={attachment} active />); });
  mockStatus = 'error';
  await act(async () => { renderer.update(<MediaVideoPage item={attachment} active />); });
  expect(renderer.root.findByType(AppText).props.children).toBe('attach.video_unsupported_desktop');
  expect(renderer.root.findAllByType(VideoView)).toHaveLength(0);
  expect(renderer.root.findAllByType(AppButton)).toHaveLength(0);
  expect(Sharing.shareAsync).not.toHaveBeenCalled();
  expect(mockPlayer.pause).not.toHaveBeenCalled();
});

it('offers the cached video to external mobile apps without downloading it again', async () => {
  mockCached = 'file:///cached.mp4';
  mockPlayer.replaceAsync.mockRejectedValueOnce(new Error('Unsupported codec'));
  await act(async () => { renderer = create(<MediaVideoPage item={attachment} active />); });
  expect(renderer.root.findByType(AppText).props.children).toBe('attach.video_unsupported');
  await act(async () => { renderer.root.findByType(AppButton).props.onPress(); });
  expect(copyForShare).toHaveBeenCalledWith(mockCached, undefined);
  expect(Sharing.shareAsync).toHaveBeenCalledWith('file:///share-copy.mp4', { mimeType: 'video/mp4' });
  expect(fetchVideo).not.toHaveBeenCalled();
  expect(mockPlayer.play).not.toHaveBeenCalled();
});

it('shows unsupported status for direct video failures instead of a blank player', async () => {
  mockElectron = true;
  mockPlayer.replaceAsync.mockRejectedValueOnce(new Error('Unsupported codec'));
  await act(async () => { renderer = create(<MediaVideoPage item={remote} active />); });
  expect(renderer.root.findByType(AppText).props.children).toBe('attach.video_unsupported_desktop');
  expect(renderer.root.findAllByType(VideoView)).toHaveLength(0);
});

jest.mock('@/components/chat/AttachmentTransferProgress', () => ({ AttachmentTransferProgress: () => null }));
jest.mock('lucide-react-native/icons/download', () => ({ __esModule: true, default: () => null }));
