import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { StyleSheet, View } from 'react-native';

import { InteractivePressable } from '@/components/common/InteractivePressable';
import { IconButton } from '@/components/common/IconButton';
import { platform } from '@/platform';
import { fetchAndDecryptAttachment } from '@/services/files/file-attachment.service';
import { darkPalette, lightPalette } from '@/theme';

import { AttachmentFrame } from '../AttachmentFrame';
import { AttachmentAudio } from '../AttachmentAudio';
import { AttachmentFile } from '../AttachmentFile';
import { AttachmentVideo } from '../AttachmentVideo';
import { AudioClock } from '../audio-clock';
import { VoiceWaveform } from '../VoiceWaveform';

jest.mock('@/platform', () => ({
  platform: { confirmationDialog: { confirm: jest.fn(), notify: jest.fn() } },
}));
jest.mock('@/services/files/file-attachment.service', () => ({
  fetchAndDecryptAttachment: jest.fn(),
  getCachedAttachmentUri: jest.fn(async () => null),
  getSessionCachedUri: jest.fn(() => null),
  copyForShare: jest.fn(async (uri: string) => uri),
  attachmentErrorKind: (error: { kind?: string }) => error.kind ?? 'download',
}));
jest.mock('@/stores/active-account.store', () => ({
  useActiveAccount: (selector: (state: { activePubkey: string }) => unknown) =>
    selector({ activePubkey: 'account' }),
}));
jest.mock('@/stores/attachment-transfer.store', () => ({ useAttachmentTransfer: () => null }));

let mockThemePreference: 'light' | 'dark' = 'light';
jest.mock('@/stores/theme.store', () => ({
  useThemeStore: (selector: (state: { accent: 'blue'; preference: 'light' | 'dark' }) => unknown) =>
    selector({ accent: 'blue', preference: mockThemePreference }),
}));
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));

jest.mock('@solar-icons/react-native/category/security/Linear/ShieldWarning', () => ({
  ShieldWarning: () => null,
}), { virtual: true });
jest.mock('@solar-icons/react-native/category/ui/Linear/DangerTriangle', () => ({
  DangerTriangle: () => null,
}), { virtual: true });
jest.mock('@solar-icons/react-native/category/files/Linear/FileText', () => ({ FileText: () => null }), { virtual: true });
jest.mock('@solar-icons/react-native/category/video/Linear/Clapperboard', () => ({ Clapperboard: () => null }), { virtual: true });
jest.mock('@solar-icons/react-native/category/video/Linear/Play', () => ({ Play: () => null }), { virtual: true });
jest.mock('@solar-icons/react-native/category/video/Linear/Pause', () => ({ Pause: () => null }), { virtual: true });
jest.mock('lucide-react-native/icons/download', () => ({ __esModule: true, default: () => null }));
jest.mock('../AttachmentTransferProgress', () => ({ AttachmentTransferProgress: () => null }));
jest.mock('../VoiceWaveform', () => ({ VoiceWaveform: () => null }));
jest.mock('expo-image', () => ({ Image: () => null }));
jest.mock('expo', () => ({ useEvent: () => ({ status: 'idle' }) }));
jest.mock('expo-video', () => ({ useVideoPlayer: () => ({ status: 'idle', play: jest.fn() }), VideoView: () => null }));
jest.mock('expo-audio', () => ({
  useAudioPlayer: () => ({}),
  useAudioPlayerStatus: () => ({ duration: 0, currentTime: 0, playing: false, isLoaded: false }),
}));
jest.mock('expo-sharing', () => ({ isAvailableAsync: async () => false }));

const META = {
  url: 'https://media.example/file',
  cipherSha256Hex: 'a'.repeat(64),
  decryptionKeyHex: 'b'.repeat(64),
  decryptionNonceHex: 'c'.repeat(24),
  name: 'recording.mp3',
  size: 1024,
  durationSec: 12,
  waveform: [5, 10, 5],
  dim: '1000x10',
  thumbhash: 'placeholder',
};

let renderer: ReactTestRenderer;

afterEach(() => {
  act(() => renderer?.unmount());
  mockThemePreference = 'light';
  jest.clearAllMocks();
});

function sideButton() {
  return renderer.root.findByType(IconButton);
}

async function pressSide() {
  await act(async () => { sideButton().props.onPress(); });
}

describe('attachment side failure action', () => {
  const onRetry = jest.fn();

  function render(failure: 'download' | 'integrity' | null, isSelf = false) {
    const element = (
      <AttachmentFrame failure={failure} action="show" onRetry={onRetry} isSelf={isSelf}>
        <View style={{ width: 240, height: 2.4, overflow: 'hidden' }} />
      </AttachmentFrame>
    );
    act(() => {
      renderer = create(element);
    });
  }

  it.each(['light', 'dark'] as const)('uses a warning action outside the media clip in %s mode', (scheme) => {
    mockThemePreference = scheme;
    render('download');
    const palette = scheme === 'dark' ? darkPalette : lightPalette;
    expect(sideButton().props.icon.props.color).toBe(palette.warning);
    expect(sideButton().props.accessibilityLabel).toBe('attach.download_failed');
    let ancestor = sideButton().parent;
    while (ancestor) {
      const style = typeof ancestor.props.style === 'object'
        ? StyleSheet.flatten(ancestor.props.style) : undefined;
      expect(style?.overflow).not.toBe('hidden');
      ancestor = ancestor.parent;
    }
  });

  it('waits for the retry decision and ignores repeated presses while the dialog is open', async () => {
    let decide!: (value: boolean) => void;
    jest.mocked(platform.confirmationDialog.confirm).mockImplementationOnce(
      () => new Promise<boolean>((resolve) => { decide = resolve; }),
    );
    render('download');
    await pressSide();
    await pressSide();
    expect(platform.confirmationDialog.confirm).toHaveBeenCalledTimes(1);
    expect(onRetry).not.toHaveBeenCalled();
    await act(async () => { decide(true); });
    expect(onRetry).toHaveBeenCalledWith(false);
  });

  it('does not retry when the dialog is dismissed', async () => {
    jest.mocked(platform.confirmationDialog.confirm).mockResolvedValueOnce(false);
    render('download');
    await pressSide();
    expect(onRetry).not.toHaveBeenCalled();
  });

  it('confirms the integrity warning once before allowing a reveal', async () => {
    jest.mocked(platform.confirmationDialog.confirm).mockResolvedValueOnce(true);
    render('integrity');
    await pressSide();
    expect(platform.confirmationDialog.confirm).toHaveBeenCalledTimes(1);
    expect(platform.confirmationDialog.confirm).toHaveBeenCalledWith(expect.objectContaining({
      title: 'attach.verify_failed',
      message: 'attach.verify_failed_message',
      confirmLabel: 'attach.verify_failed_show',
      destructive: true,
    }));
    expect(onRetry).toHaveBeenCalledWith(true);
  });
});

describe.each(['audio', 'file', 'video'] as const)('%s download failure', (medium) => {
  async function renderFailure(kind: 'download' | 'integrity') {
    jest.mocked(fetchAndDecryptAttachment).mockRejectedValueOnce({ kind });
    await act(async () => {
      renderer = create(medium === 'audio'
        ? <AttachmentAudio meta={META} isSelf={false} autoDownload={false} />
        : medium === 'file'
          ? <AttachmentFile meta={META} />
          : <AttachmentVideo meta={META} />);
    });
    await act(async () => {
      renderer.root.findByType(InteractivePressable).props.onPress();
    });
  }

  it('keeps content visible and retries from the side action', async () => {
    await renderFailure('download');
    expect(sideButton().props.accessibilityLabel).toBe('attach.download_failed');
    expect(renderer.root.findAll((node) => node.children.includes('attach.download_failed'))).toHaveLength(0);
    if (medium === 'audio') {
      expect(renderer.root.findByType(VoiceWaveform)).toBeTruthy();
      expect(renderer.root.findByType(AudioClock).props.seconds).toBe(12);
    } else if (medium === 'file') {
      expect(renderer.root.findAll((node) => node.children.includes(META.name)).length).toBeGreaterThan(0);
      expect(renderer.root.findAll((node) => node.children.includes('1.0 KB')).length).toBeGreaterThan(0);
    } else {
      const scrim = renderer.root.findAllByType(View).find((node) =>
        StyleSheet.flatten(node.props.style)?.backgroundColor === lightPalette.overlay);
      expect(scrim).toBeTruthy();
      expect(scrim!.props.children).toBeUndefined();
    }
    jest.mocked(platform.confirmationDialog.confirm).mockResolvedValueOnce(true);
    jest.mocked(fetchAndDecryptAttachment).mockResolvedValueOnce('file:///attachment');
    await pressSide();
    expect(fetchAndDecryptAttachment).toHaveBeenCalledTimes(2);
    expect(fetchAndDecryptAttachment).toHaveBeenLastCalledWith(META, expect.objectContaining({
      allowIntegrityMismatch: false,
    }));
    expect(renderer.root.findAllByType(IconButton)).toHaveLength(0);
  });

  it('uses the appropriate integrity confirmation before retrying', async () => {
    await renderFailure('integrity');
    jest.mocked(platform.confirmationDialog.confirm).mockResolvedValueOnce(true);
    jest.mocked(fetchAndDecryptAttachment).mockResolvedValueOnce('file:///attachment');
    await pressSide();
    expect(platform.confirmationDialog.confirm).toHaveBeenCalledTimes(1);
    expect(platform.confirmationDialog.confirm).toHaveBeenCalledWith(expect.objectContaining({
      confirmLabel: medium === 'file' ? 'attach.verify_failed_open' : 'attach.verify_failed_play',
    }));
    expect(fetchAndDecryptAttachment).toHaveBeenLastCalledWith(META, expect.objectContaining({
      allowIntegrityMismatch: true,
    }));
  });
});
