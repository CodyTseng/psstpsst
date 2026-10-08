import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { Image } from 'expo-image';
import { useAttachment } from '@/hooks/use-attachment';
import { useVideoPoster } from '@/hooks/use-video-poster';
import type { ConversationMediaItem } from '@/hooks/use-conversation-media';
import { MediaThumbnail } from '../MediaThumbnail';

jest.mock('expo-image', () => ({ Image: () => null }));
jest.mock('@/hooks/use-attachment', () => ({ useAttachment: jest.fn() }));
jest.mock('@/hooks/use-video-poster', () => ({ useVideoPoster: jest.fn() }));
jest.mock('@/stores/media-viewer.store', () => ({ mediaViewer: { openConversation: jest.fn() } }));
jest.mock('@solar-icons/react-native/category/video/Linear/Play', () => ({ Play: () => null }), { virtual: true });
jest.mock('@/components/common/InteractivePressable', () => ({
  InteractivePressable: jest.requireActual('react-native').View,
}));
let mockThemePreference: 'light' | 'dark' = 'light';
jest.mock('@/stores/theme.store', () => ({
  useThemeStore: (selector: (value: { accent: 'blue'; preference: 'light' | 'dark' }) => unknown) =>
    selector({ accent: 'blue', preference: mockThemePreference }),
}));

const item: ConversationMediaItem = {
  source: 'attachment', isVideo: true, mediaKey: 'video', messageId: 'message', createdAt: 1, orderAt: 1,
  meta: { url: 'https://remote.example/video', mime: 'video/mp4', cipherSha256Hex: 'a'.repeat(64),
    decryptionKeyHex: 'b'.repeat(64), decryptionNonceHex: 'c'.repeat(24), thumbhash: 'preview' },
};
let renderer: ReactTestRenderer;
afterEach(() => {
  act(() => renderer?.unmount());
  jest.resetAllMocks();
});

it.each(['light', 'dark'] as const)('shows local video posters in %s mode without requesting a download', (scheme) => {
  mockThemePreference = scheme;
  jest.mocked(useAttachment).mockReturnValue({ state: { status: 'ready', localUri: 'file:///video.mp4' } } as ReturnType<typeof useAttachment>);
  jest.mocked(useVideoPoster).mockReturnValue('file:///poster.jpg');
  act(() => { renderer = create(<MediaThumbnail item={item} size={100} conversationKey="peer" autoLoad />); });
  expect(useAttachment).toHaveBeenCalledWith(item.meta, { autoLoad: false });
  expect(useVideoPoster).toHaveBeenCalledWith('file:///video.mp4');
  expect(renderer.root.findByType(Image).props.source).toEqual({ uri: 'file:///poster.jpg' });
});

it('retains ThumbHash for undownloaded video without loading a remote source', () => {
  jest.mocked(useAttachment).mockReturnValue({ state: { status: 'idle' } } as ReturnType<typeof useAttachment>);
  act(() => { renderer = create(<MediaThumbnail item={item} size={100} conversationKey="peer" autoLoad />); });
  expect(useVideoPoster).toHaveBeenCalledWith(null);
  expect(renderer.root.findByType(Image).props.source).toBeUndefined();
  expect(renderer.root.findByType(Image).props.placeholder).toEqual({ thumbhash: 'preview' });
});
