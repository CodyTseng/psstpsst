import { act, create, type ReactTestRenderer } from 'react-test-renderer';

import { PLAYBACK_AUDIO_MODE } from '@/lib/audio/audio-mode';
import { VoiceRecorderBar } from '../VoiceRecorderBar';

const mockRequestPermission = jest.fn();
const mockSetAudioMode = jest.fn();
const mockNotify = jest.fn();
const mockRecorder = {
  uri: null as string | null,
  prepareToRecordAsync: jest.fn(),
  record: jest.fn(),
  stop: jest.fn(),
  getStatus: jest.fn(() => ({ metering: -60 })),
};

jest.mock('expo-audio', () => ({
  RecordingPresets: { HIGH_QUALITY: { web: {} } },
  requestRecordingPermissionsAsync: () => mockRequestPermission(),
  setAudioModeAsync: (mode: unknown) => mockSetAudioMode(mode),
  useAudioRecorder: () => mockRecorder,
  useAudioPlayer: () => ({
    pause: jest.fn(),
    play: jest.fn(),
    seekTo: jest.fn(),
  }),
  useAudioPlayerStatus: () => ({
    currentTime: 0,
    duration: 0,
    playing: false,
  }),
}));
jest.mock('@solar-icons/react-native/category/arrows/Linear/ArrowUp', () => ({ ArrowUp: () => null }), { virtual: true });
jest.mock('@solar-icons/react-native/category/video/Linear/Pause', () => ({ Pause: () => null }), { virtual: true });
jest.mock('@solar-icons/react-native/category/video/Linear/Play', () => ({ Play: () => null }), { virtual: true });
jest.mock('@solar-icons/react-native/category/video/Linear/Stop', () => ({ Stop: () => null }), { virtual: true });
jest.mock('@solar-icons/react-native/category/ui/Linear/TrashBinTrash', () => ({ TrashBinTrash: () => null }), { virtual: true });
jest.mock('lucide-react-native/icons/x', () => () => null, { virtual: true });

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
}));
jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

jest.mock('@/lib/platform', () => ({ IS_ELECTRON: false }));
jest.mock('@/platform', () => ({
  platform: {
    confirmationDialog: {
      notify: (options: unknown) => mockNotify(options),
    },
  },
}));
jest.mock('@/theme', () => ({
  bottomBarHeight: 56,
  useThemeColors: () => ({
    background: '#000',
    border: '#111',
    danger: '#f00',
    surfaceMuted: '#222',
    text: '#fff',
    textMuted: '#aaa',
  }),
}));
jest.mock('@/theme/icons', () => ({ iconStrokeWidth: { default: 1.5 } }));
jest.mock('@/components/common/AppText', () => ({ AppText: () => null }));
jest.mock('@/components/common/ChromeBackdrop', () => ({ ChromeBackdrop: () => null }));
jest.mock('@/components/common/IconButton', () => ({ IconButton: () => null }));
jest.mock('../VoiceWaveform', () => ({ VoiceWaveform: () => null }));
jest.mock('../audio-clock', () => ({ AudioClock: () => null }));

describe('VoiceRecorderBar startup', () => {
  let renderer: ReactTestRenderer | undefined;

  beforeEach(() => {
    jest.clearAllMocks();
    mockRecorder.stop.mockResolvedValue(undefined);
    mockSetAudioMode.mockResolvedValue(undefined);
    mockNotify.mockResolvedValue(undefined);
  });

  afterEach(() => {
    act(() => renderer?.unmount());
    renderer = undefined;
  });

  it('restores playback mode and exits when native recorder setup fails', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const onCancel = jest.fn();
    mockRequestPermission.mockRejectedValue(new Error('native recorder unavailable'));

    await act(async () => {
      renderer = create(<VoiceRecorderBar onSendVoice={jest.fn()} onCancel={onCancel} />);
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(mockRecorder.stop).toHaveBeenCalledTimes(1);
    expect(mockSetAudioMode).toHaveBeenCalledWith(PLAYBACK_AUDIO_MODE);
    expect(mockNotify).toHaveBeenCalledWith({
      title: 'error.unexpected_title',
      okLabel: 'common.ok',
    });
    expect(onCancel).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });
});
