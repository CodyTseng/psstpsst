import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { StyleSheet, View } from 'react-native';

import type { UseAttachment } from '@/hooks/use-attachment';
import { useAttachment } from '@/hooks/use-attachment';
import type { FileAttachmentMeta } from '@/lib/nostr/file-tags';
import { useAttachmentTransfer } from '@/stores/attachment-transfer.store';
import { lightPalette } from '@/theme';
import { platform } from '@/platform';
import { IconButton } from '@/components/common/IconButton';

import { AttachmentImage } from '../AttachmentImage';

jest.mock('@/platform', () => ({
  platform: { confirmationDialog: { confirm: jest.fn() } },
}));
jest.mock('@solar-icons/react-native/category/security/Linear/ShieldWarning', () => ({
  ShieldWarning: () => null,
}), { virtual: true });
jest.mock('@solar-icons/react-native/category/ui/Linear/DangerTriangle', () => ({
  DangerTriangle: () => null,
}), { virtual: true });

jest.mock('expo-image', () => ({
  Image: (props: Record<string, unknown>) => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const React = require('react') as typeof import('react');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const NativeView = (require('react-native') as typeof import('react-native')).View;
    return React.createElement(NativeView, { ...props, testID: 'attachment-image' });
  },
}));

jest.mock(
  'lucide-react-native/icons/download',
  () => ({
    __esModule: true,
    default: () => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const React = require('react') as typeof import('react');
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const NativeView = (require('react-native') as typeof import('react-native')).View;
      return React.createElement(NativeView, { testID: 'download-action' });
    },
  }),
  { virtual: true },
);

jest.mock('@/components/chat/AttachmentTransferProgress', () => ({
  AttachmentTransferProgress: (props: Record<string, unknown>) => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const React = require('react') as typeof import('react');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const NativeView = (require('react-native') as typeof import('react-native')).View;
    return React.createElement(NativeView, { ...props, testID: 'attachment-progress' });
  },
}));

jest.mock('@/hooks/use-attachment', () => ({
  useAttachment: jest.fn(),
}));

jest.mock('@/stores/active-account.store', () => ({
  useActiveAccount: (selector: (state: { activePubkey: string }) => unknown) =>
    selector({ activePubkey: 'account' }),
}));

jest.mock('@/stores/attachment-transfer.store', () => ({
  useAttachmentTransfer: jest.fn(),
}));

jest.mock('@/stores/theme.store', () => ({
  useThemeStore: (selector: (state: { accent: 'blue'; preference: 'light' }) => unknown) =>
    selector({ accent: 'blue', preference: 'light' }),
}));

jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

const META: FileAttachmentMeta = {
  url: 'blossom:example',
  cipherSha256Hex: 'a'.repeat(64),
  decryptionKeyHex: 'b'.repeat(64),
  decryptionNonceHex: 'c'.repeat(24),
  thumbhash: 'thumbhash-data',
  dim: '640x480',
};

const controls = {
  load: jest.fn(),
  pause: jest.fn(),
  resume: jest.fn(),
  retry: jest.fn(),
  reveal: jest.fn(),
};

function renderWithState(state: UseAttachment['state']): ReactTestRenderer {
  jest.mocked(useAttachment).mockReturnValue({ state, ...controls });
  let renderer: ReactTestRenderer | undefined;
  act(() => {
    renderer = create(<AttachmentImage meta={META} messageId="rumor" />);
  });
  return renderer!;
}

function fullImageScrims(renderer: ReactTestRenderer) {
  return renderer.root.findAllByType(View).filter((node) => {
    const style = StyleSheet.flatten(node.props.style);
    return (
      style?.position === 'absolute' &&
      style?.top === 0 &&
      style?.right === 0 &&
      style?.bottom === 0 &&
      style?.left === 0 &&
      style?.backgroundColor === lightPalette.overlay
    );
  });
}

describe('AttachmentImage transfer states', () => {
  let renderer: ReactTestRenderer | undefined;

  beforeEach(() => {
    jest.mocked(useAttachmentTransfer).mockReturnValue(null);
  });

  afterEach(() => {
    act(() => renderer?.unmount());
    renderer = undefined;
    jest.clearAllMocks();
  });

  it('keeps the ThumbHash visible behind a failed download', () => {
    renderer = renderWithState({ status: 'error', kind: 'download' });

    const image = renderer.root
      .findAllByType(View)
      .find((node) => node.props.testID === 'attachment-image')!;
    expect(image.props.placeholder).toEqual({ thumbhash: 'thumbhash-data' });
    expect(fullImageScrims(renderer)).toHaveLength(1);
    expect(fullImageScrims(renderer)[0].props.children).toBeUndefined();
    expect(renderer.root.findByProps({ accessibilityLabel: 'attach.download_failed' })).toBeTruthy();
  });

  it('keeps the image unobscured while showing download progress', () => {
    jest.mocked(useAttachmentTransfer).mockReturnValue({
      source: 'network',
      receivedBytes: 50,
      totalBytes: 100,
      percent: 50,
    });
    renderer = renderWithState({ status: 'loading' });

    expect(fullImageScrims(renderer)).toHaveLength(0);
    expect(renderer.root.findAllByProps({ testID: 'attachment-progress' })).not.toHaveLength(0);
  });

  it.each(['download', 'integrity'] as const)('retries a %s failure from the side action', async (kind) => {
    jest.mocked(platform.confirmationDialog.confirm).mockResolvedValueOnce(true);
    renderer = renderWithState({ status: 'error', kind });

    await act(async () => {
      renderer!.root.findByType(IconButton).props.onPress();
    });

    expect(platform.confirmationDialog.confirm).toHaveBeenCalledTimes(1);
    expect(kind === 'integrity' ? controls.reveal : controls.retry).toHaveBeenCalledTimes(1);
    expect(kind === 'integrity' ? controls.retry : controls.reveal).not.toHaveBeenCalled();
  });

  it('shows a download action after pausing', () => {
    renderer = renderWithState({ status: 'paused' });

    expect(
      renderer.root
        .findAllByType(View)
        .filter((node) => node.props.testID === 'download-action'),
    ).toHaveLength(1);
    expect(renderer.root.findByProps({ accessibilityLabel: 'common.resume' })).toBeTruthy();
  });
});
