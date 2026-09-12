import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

import type { PendingAttachment } from '@/stores/pending-attachments.store';
import { platform } from '@/platform';
import { darkPalette, lightPalette } from '@/theme';

import { PendingAttachmentBubble } from '../PendingAttachmentBubble';

jest.mock('@/stores/pending-attachments.store', () => ({
  PENDING_UPLOAD_INTERRUPTED: 'UPLOAD_INTERRUPTED',
}));

jest.mock('@/platform', () => ({
  platform: {
    confirmationDialog: {
      confirm: jest.fn(),
      notify: jest.fn(),
    },
  },
}));
jest.mock(
  '@solar-icons/react-native/category/files/Linear/FileText',
  () => ({ FileText: () => null }),
  { virtual: true },
);
jest.mock(
  '@solar-icons/react-native/category/video/Linear/Clapperboard',
  () => ({ Clapperboard: () => null }),
  { virtual: true },
);
jest.mock(
  '@solar-icons/react-native/category/video/Linear/Play',
  () => ({ Play: () => null }),
  { virtual: true },
);
jest.mock(
  '@solar-icons/react-native/category/ui/Linear/DangerTriangle',
  () => ({ DangerTriangle: () => null }),
  { virtual: true },
);

jest.mock('expo-image', () => ({
  Image: (props: Record<string, unknown>) => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const React = require('react') as typeof import('react');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const NativeView = (require('react-native') as typeof import('react-native')).View;
    return React.createElement(NativeView, props);
  },
}));

jest.mock('expo-video', () => ({
  useVideoPlayer: jest.fn(),
  VideoView: (props: Record<string, unknown>) => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const React = require('react') as typeof import('react');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const NativeView = (require('react-native') as typeof import('react-native')).View;
    return React.createElement(NativeView, props);
  },
}));

jest.mock('react-native-gesture-handler', () => ({
  Gesture: {
    LongPress: () => {
      const gesture = {
        enabled: () => gesture,
        minDuration: () => gesture,
        onStart: () => gesture,
      };
      return gesture;
    },
  },
  GestureDetector: ({ children }: { children: ReactNode }) => children,
}));

jest.mock('react-native-reanimated', () => ({
  runOnJS: (callback: (...args: unknown[]) => unknown) => callback,
}));

jest.mock('lucide-react-native/icons/upload', () => ({
  __esModule: true,
  default: () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const React = require('react') as typeof import('react');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const NativeView = (require('react-native') as typeof import('react-native')).View;
    return React.createElement(NativeView, { testID: 'resume-upload' });
  },
}));
jest.mock('lucide-react-native/icons/x', () => ({
  __esModule: true,
  default: (props: Record<string, unknown>) => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const React = require('react') as typeof import('react');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const NativeView = (require('react-native') as typeof import('react-native')).View;
    return React.createElement(NativeView, { ...props, testID: 'discard-x' });
  },
}));

jest.mock('../AttachmentTransferProgress', () => ({
  AttachmentTransferProgress: (props: Record<string, unknown>) => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const React = require('react') as typeof import('react');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const NativeView = (require('react-native') as typeof import('react-native')).View;
    return React.createElement(NativeView, { ...props, testID: 'upload-progress' });
  },
}));

let mockThemePreference: 'light' | 'dark' = 'light';
jest.mock('@/stores/theme.store', () => ({
  useThemeStore: (selector: (state: { accent: 'blue'; preference: 'light' | 'dark' }) => unknown) =>
    selector({ accent: 'blue', preference: mockThemePreference }),
}));

jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

const BASE: PendingAttachment = {
  accountPubkey: 'account',
  tempId: 'pending',
  conversationKey: 'conversation',
  localUri: 'file:///photo.jpg',
  mime: 'image/jpeg',
  width: 640,
  height: 480,
  status: 'uploading',
};

describe('pending attachment transfer controls', () => {
  let renderer: ReactTestRenderer | undefined;
  const onStop = jest.fn();
  const onRetry = jest.fn();
  const onCancel = jest.fn();

  afterEach(() => {
    act(() => renderer?.unmount());
    renderer = undefined;
    mockThemePreference = 'light';
    jest.clearAllMocks();
  });

  function render(pending: PendingAttachment) {
    act(() => {
      renderer = create(
        <PendingAttachmentBubble
          pending={pending}
          onStop={onStop}
          onRetry={onRetry}
          onCancel={onCancel}
        />,
      );
    });
  }

  it.each(['light', 'dark'] as const)('keeps pause and quiet discard separate in %s mode', (scheme) => {
    mockThemePreference = scheme;
    const palette = scheme === 'dark' ? darkPalette : lightPalette;
    render(BASE);

    expect(renderer!.root.findByProps({ testID: 'upload-progress' })).toBeTruthy();
    const discard = renderer!.root
      .findAllByProps({ accessibilityLabel: 'attach.discard_upload' })
      .find((node) => typeof node.props.style === 'function')!;
    expect(discard.props.style({ pressed: false })).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ backgroundColor: palette.dangerSoft }),
      ]),
    );
    expect(renderer!.root.findByProps({ testID: 'discard-x' }).props.color).toBe(
      palette.danger,
    );
    act(() => {
      void renderer!.root.findByProps({ accessibilityLabel: 'common.pause' }).props.onPress();
    });
    act(() => {
      void renderer!.root
        .findByProps({ accessibilityLabel: 'attach.discard_upload' })
        .props.onPress();
    });

    expect(onStop).toHaveBeenCalledWith('pending');
    expect(onCancel).toHaveBeenCalledWith('pending');
  });

  it('starts with a centred ring and no preparation label', () => {
    render({ ...BASE, status: 'preparing' });

    expect(renderer!.root.findByProps({ testID: 'upload-progress' }).props).toMatchObject({
      fallbackPercent: 5,
      pauseAvailable: true,
    });
    expect(
      renderer!.root.findAll(
        (node) => node.children.includes('attach.upload_preparing'),
      ),
    ).toHaveLength(0);
  });

  it('keeps the message row transparent over the conversation canvas', () => {
    render(BASE);

    const row = renderer!.root.findAllByType(View)[0];
    expect(StyleSheet.flatten(row.props.style).backgroundColor).toBe('transparent');
  });

  it('resumes from the upload glyph without rendering the old action row', () => {
    render({ ...BASE, status: 'paused' });

    expect(renderer!.root.findByProps({ testID: 'resume-upload' })).toBeTruthy();
    expect(renderer!.root.findAllByProps({ label: 'common.retry' })).toHaveLength(0);
    expect(renderer!.root.findAllByProps({ label: 'attach.discard_upload' })).toHaveLength(0);
    act(() => {
      void renderer!.root.findByProps({ accessibilityLabel: 'common.resume' }).props.onPress();
    });

    expect(onRetry).toHaveBeenCalledWith('pending');
  });

  it('discards failures from the stop control and offers retry in failure details', async () => {
    jest.mocked(platform.confirmationDialog.confirm).mockResolvedValue(true);
    render({ ...BASE, status: 'failed', error: 'Network unavailable' });

    expect(renderer!.root.findAllByProps({ label: 'common.retry' })).toHaveLength(0);
    expect(renderer!.root.findAllByProps({ label: 'attach.discard_upload' })).toHaveLength(0);
    const discard = renderer!.root
      .findAllByProps({ accessibilityLabel: 'attach.discard_upload' })
      .find((node) => typeof node.props.style === 'function')!;
    act(() => {
      void discard.props.onPress();
    });
    expect(onCancel).toHaveBeenCalledWith('pending');

    await act(async () => {
      void renderer!.root
        .findByProps({ accessibilityLabel: 'attach.upload_failure_title' })
        .props.onPress();
      await Promise.resolve();
    });

    expect(platform.confirmationDialog.confirm).toHaveBeenCalledWith({
      title: 'attach.upload_failure_title',
      message: 'Network unavailable',
      cancelLabel: 'common.close',
      confirmLabel: 'common.retry',
    });
    expect(onRetry).toHaveBeenCalledWith('pending');
  });
});
