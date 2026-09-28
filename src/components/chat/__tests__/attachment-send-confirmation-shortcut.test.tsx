import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { TextInput } from 'react-native';

import { AttachmentSendConfirmContent } from '../AttachmentSendConfirmation';

let mockEnterToSend = true;

jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

jest.mock('expo-image', () => ({ Image: () => null }));
jest.mock('expo-video', () => ({
  useVideoPlayer: () => ({}),
  VideoView: () => null,
}));
jest.mock('lucide-react-native/icons/x', () => 'XIcon');

jest.mock(
  '@solar-icons/react-native/category/files/Linear/FileText',
  () => ({ FileText: () => null }),
  { virtual: true },
);
jest.mock(
  '@solar-icons/react-native/category/messages/Linear/Plain3',
  () => ({ Plain3: () => null }),
  { virtual: true },
);
jest.mock(
  '@solar-icons/react-native/category/ui/Linear/TrashBinTrash',
  () => ({ TrashBinTrash: () => null }),
  { virtual: true },
);
jest.mock(
  '@solar-icons/react-native/category/video/Linear/Gallery',
  () => ({ Gallery: () => null }),
  { virtual: true },
);
jest.mock(
  '@solar-icons/react-native/category/video/Linear/MusicNote',
  () => ({ MusicNote: () => null }),
  { virtual: true },
);
jest.mock(
  '@solar-icons/react-native/category/video/Linear/Play',
  () => ({ Play: () => null }),
  { virtual: true },
);
jest.mock(
  '@solar-icons/react-native/category/video/Linear/VideoFramePlayHorizontal',
  () => ({ VideoFramePlayHorizontal: () => null }),
  { virtual: true },
);

jest.mock('@/components/common/IconButton', () => ({
  IconButton: () => null,
}));

jest.mock('@/components/common/AppText', () => ({
  AppText: () => null,
}));

jest.mock('@/components/common/BottomSheet', () => ({
  BottomSheet: () => null,
}));

jest.mock('@/components/common/DialogSurface', () => ({
  DialogSurface: () => null,
}));

jest.mock('@/components/common/ListRow', () => ({
  ListRow: () => null,
}));

jest.mock('@/i18n/direction', () => ({
  useDirectionalIconStyle: () => undefined,
}));

jest.mock('@/lib/platform', () => ({
  DESKTOP_OS: 'darwin',
  IS_ELECTRON: true,
}));

jest.mock('@/stores/chat-prefs.store', () => ({
  useChatPrefsStore: (
    selector: (state: { enterToSend: boolean }) => unknown,
  ) => selector({ enterToSend: mockEnterToSend }),
}));

jest.mock('@/stores/theme.store', () => ({
  useThemeStore: (
    selector: (state: { accent: 'blue'; preference: 'light' }) => unknown,
  ) => selector({ accent: 'blue', preference: 'light' }),
}));

describe('AttachmentSendConfirmContent desktop shortcut', () => {
  let renderer: ReactTestRenderer | undefined;

  afterEach(() => {
    act(() => renderer?.unmount());
    renderer = undefined;
    mockEnterToSend = true;
  });

  function renderContent(onSubmit: () => void) {
    act(() => {
      renderer = create(
        <AttachmentSendConfirmContent
          files={[
            {
              source: { kind: 'uri', uri: 'file:///document.pdf' },
              mime: 'application/pdf',
              name: 'document.pdf',
            },
          ]}
          imageQuality="optimized"
          onImageQualityChange={() => {}}
          message=""
          onMessageChange={() => {}}
          onSubmit={onSubmit}
          sendDisabled={false}
          inputBackgroundColor="transparent"
          onRemoveFile={() => {}}
          onImageDimensions={() => {}}
        />,
      );
    });
    return renderer!.root.findByType(TextInput);
  }

  it('takes focus when the desktop dialog opens and sends with Enter when enabled', () => {
    const onSubmit = jest.fn();
    const input = renderContent(onSubmit);
    const preventDefault = jest.fn();

    expect(input.props.autoFocus).toBe(true);
    act(() => {
      input.props.onKeyPress({
        nativeEvent: { key: 'Enter' },
        preventDefault,
      });
    });

    expect(preventDefault).toHaveBeenCalledTimes(1);
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it('uses Command+Enter when Enter-to-send is disabled', () => {
    mockEnterToSend = false;
    const onSubmit = jest.fn();
    const input = renderContent(onSubmit);

    act(() => {
      input.props.onKeyPress({
        nativeEvent: { key: 'Enter' },
        preventDefault: jest.fn(),
      });
    });
    expect(onSubmit).not.toHaveBeenCalled();

    act(() => {
      input.props.onKeyPress({
        nativeEvent: { key: 'Enter', metaKey: true },
        preventDefault: jest.fn(),
      });
    });
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });
});
