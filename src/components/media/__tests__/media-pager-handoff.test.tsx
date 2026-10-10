import type { ReactNode } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { FlatList } from 'react-native';

import { useAttachment } from '@/hooks/use-attachment';
import { useConversationMedia, type ConversationMediaItem } from '@/hooks/use-conversation-media';
import type { MediaViewerPreview } from '@/stores/media-viewer.store';
import { MediaPager } from '../MediaPager';
import { MediaTouchPager } from '../MediaTouchPager';
import { MediaVideoPage } from '../MediaVideoPage';
import { platform } from '@/platform';
import { MediaDismissSurface } from '../MediaDismissSurface';

let mockWidth = 390;
let mockHeight = 844;
jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({
  __esModule: true, default: () => ({ width: mockWidth, height: mockHeight, scale: 1, fontScale: 1 }),
}));
let mockEntered = false;
let mockElectron = false;
let mockLoaded = false;
let mockItems: ConversationMediaItem[] = [];
let mockInstance = 0;
const mockMounted = jest.fn();
const mockUnmounted = jest.fn();
const mockScrollToOffset = jest.fn();
const mockRequestClose = jest.fn();

jest.mock('expo-image', () => ({ Image: () => null }));
jest.mock('expo-router', () => ({ router: { navigate: jest.fn() } }));
jest.mock('@solar-icons/react-native/category/messages/Linear/ChatRound', () => ({ ChatRound: () => null }), { virtual: true });
jest.mock('@solar-icons/react-native/category/video/Linear/GalleryWide', () => ({ GalleryWide: () => null }), { virtual: true });
jest.mock('lucide-react-native/icons/download', () => ({ __esModule: true, default: () => null }), { virtual: true });
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
jest.mock('@/lib/platform', () => ({ get IS_ELECTRON() { return mockElectron; } }));
jest.mock('@/platform', () => ({ platform: { screenOrientation: { setVideoActive: jest.fn().mockResolvedValue(undefined) } } }));
jest.mock('@/services/files/media-save.service', () => ({ saveAttachmentToLibrary: jest.fn(), saveRemoteMediaToLibrary: jest.fn() }));
jest.mock('@/lib/attachments/failure', () => ({ revealOrRetry: jest.fn() }));
jest.mock('@/stores/active-account.store', () => ({ useActiveAccount: () => 'account' }));
jest.mock('@/theme', () => ({ useThemeColors: () => ({}), desktopChrome: { titlebarHeight: 32 }, uiDensity: {} }));
jest.mock('../MediaTouchPager', () => ({ MediaTouchPager: ({ pageKey, children }: { pageKey: string; children: ReactNode }) => {
  const React = jest.requireActual('react') as typeof import('react');
  return React.createElement(React.Fragment, { key: pageKey }, children);
} }));
jest.mock('../MediaVideoPage', () => ({ MediaVideoPage: () => null }));
jest.mock('../MediaDismissSurface', () => ({
  MediaDismissSurface: ({ children }: { children: ReactNode }) => children,
}));
jest.mock('../MediaViewerTopBar', () => ({ MediaViewerTopBar: () => null }));
jest.mock('../use-media-viewer-transition', () => ({
  useMediaViewerTransition: () => ({
    entered: mockEntered, isClosing: false, animatedStyle: {}, contentStyle: {},
    requestClose: mockRequestClose,
  }),
}));
jest.mock('@/hooks/use-conversation-media', () => ({
  useConversationMedia: jest.fn(() => ({
    items: mockItems, loaded: mockLoaded, hasMore: false, hasMoreNewer: false,
    loadOlder: jest.fn(), loadNewer: jest.fn(),
  })),
}));
jest.mock('@/hooks/use-attachment', () => ({
  useAttachment: jest.fn(() => ({ state: { status: 'loading' } })),
}));
jest.mock('react-native-reanimated', () => {
  const React = jest.requireActual('react') as typeof import('react');
  return { __esModule: true, default: { View: jest.requireActual('react-native').View },
    Easing: { out: () => (value: number) => value },
    ReduceMotion: { System: 'system' },
    LinearTransition: {
      duration() { return this; }, easing() { return this; }, reduceMotion() { return this; },
    },
    useSharedValue: (value: number) => React.useRef({ value }).current };
});
jest.mock('@/components/common/ZoomableImage', () => {
  const React = jest.requireActual('react') as typeof import('react');
  return { ZoomableImage: ({ uri, ...props }: { uri: string }) => {
    const [instance] = React.useState(() => ++mockInstance);
    React.useEffect(() => {
      mockMounted(uri, instance);
      return () => { mockUnmounted(uri, instance); };
    }, [uri, instance]);
    return React.createElement('image', { ...props, uri, instance });
  } };
});
jest.mock('react-native/Libraries/Lists/FlatList', () => {
  const React = jest.requireActual('react') as typeof import('react');
  type MockItem = { mediaKey: string };
  type MockProps = { data: MockItem[]; renderItem: (args: { item: MockItem; index: number }) => ReactNode };
  return { __esModule: true, default: React.forwardRef(function TestList(props: MockProps, ref) {
    React.useImperativeHandle(ref, () => ({ scrollToOffset: mockScrollToOffset }));
    return React.createElement('list', {}, props.data.map((item, index) =>
      React.createElement(React.Fragment, { key: item.mediaKey }, props.renderItem({ item, index }))));
  }) };
});

const focusUrl = 'https://media.test/encrypted';
const focusKey = `focus\u0000${focusUrl}`;
const preview: MediaViewerPreview = {
  uri: 'file:///decoded.png', cacheKey: 'decoded',
};
const focus = { source: 'attachment', mediaKey: focusKey, messageId: 'focus', orderAt: 2, createdAt: 2,
  isVideo: false, meta: { url: focusUrl, thumbhash: 'blurred-preview' } } as ConversationMediaItem;
function neighbour(id: string): ConversationMediaItem {
  return { source: 'embedded', mediaKey: `${id}\u0000https://media.test/${id}`, messageId: id,
    orderAt: 1, createdAt: 1, isVideo: false, meta: { url: `https://media.test/${id}`, kind: 'image' } };
}
let renderer: ReactTestRenderer | undefined;
function render() {
  const element = <MediaPager preview={preview} conversationKey="chat" focusMessageId="focus" focusOrderAt={2} focusUrl={focusUrl} showGrid onClose={jest.fn()} />;
  act(() => { if (renderer) renderer.update(element); else renderer = create(element); });
}
const image = () => renderer!.root.findByProps({ uri: preview.uri });

beforeEach(() => {
  jest.clearAllMocks(); mockWidth = 390; mockHeight = 844; mockEntered = false; mockElectron = false; mockLoaded = false; mockItems = []; mockInstance = 0;
});
afterEach(() => { act(() => renderer?.unmount()); renderer = undefined; });

it('keeps the exact decoded image instance as deferred neighbouring pages arrive', () => {
  render();
  const instance = image().props.instance;
  expect(renderer!.root.findByType(MediaTouchPager).props.pageKey).toBe(focusKey);
  expect(jest.mocked(useConversationMedia).mock.calls.at(-1)?.[3]).toBe(false);
  mockEntered = true;
  render();
  expect(jest.mocked(useConversationMedia).mock.calls.at(-1)?.[3]).toBe(true);
  expect(image().props.instance).toBe(instance);
  mockItems = [neighbour('older'), focus, neighbour('newer')]; mockLoaded = true;
  render();
  expect(image().props.instance).toBe(instance);
  expect(image().props.cacheKey).toBe('decoded');
  expect(image().props.thumbhash).toBeUndefined();
  expect(mockUnmounted).not.toHaveBeenCalledWith(preview.uri, instance);
  expect(useAttachment).not.toHaveBeenCalled();
  expect(renderer!.root.findByType(MediaTouchPager).props.pageKey).toBe(focusKey);
  expect(renderer!.root.findAllByType(FlatList)).toHaveLength(0);
});

it('retains the source when older pages are prepended again', () => {
  render();
  const instance = image().props.instance;
  mockEntered = true; mockLoaded = true; mockItems = [neighbour('older'), focus]; render();
  mockItems = [neighbour('oldest'), ...mockItems]; render();
  expect(image().props.instance).toBe(instance);
  expect(mockMounted.mock.calls.filter(([uri]) => uri === preview.uri)).toHaveLength(1);
  expect(mockUnmounted).not.toHaveBeenCalledWith(preview.uri, instance);
});

it('positions the retained source on Electron before paint without remounting it', () => {
  mockElectron = true;
  render();
  const instance = image().props.instance;
  mockLoaded = true; mockItems = [neighbour('older'), focus]; render();
  const list = renderer!.root.findByType(FlatList);
  const expectedOffset = list.props.getItemLayout(null, 1).offset;
  expect(mockScrollToOffset).toHaveBeenCalledWith({ offset: expectedOffset, animated: false });
  expect(image().props.instance).toBe(instance);
});

it('does not mount neighbouring remote images until the user selects their page', () => {
  mockEntered = true;
  mockLoaded = true;
  mockItems = [neighbour('older'), focus, neighbour('newer')];
  render();
  expect(mockMounted.mock.calls.map(([uri]) => uri)).toEqual([preview.uri]);

  act(() => { renderer!.root.findByType(MediaTouchPager).props.onPage(1); });
  expect(mockMounted.mock.calls.map(([uri]) => uri)).toEqual([
    preview.uri,
    'https://media.test/newer',
  ]);
});

it('connects video dismissal to the viewer transition only on the selected page', () => {
  mockEntered = true;
  mockLoaded = true;
  mockItems = [focus, ...['first', 'second'].map((id) => ({
    ...neighbour(id), isVideo: true,
  }))];
  render();
  act(() => { renderer!.root.findByType(MediaTouchPager).props.onPage(1); });
  const surfaces = renderer!.root.findAllByType(MediaDismissSurface);
  expect(surfaces.map((surface) => surface.props.active)).toEqual([true]);
  act(() => { surfaces[0].props.onRequestClose(); });
  expect(mockRequestClose).toHaveBeenCalledTimes(1);
});

jest.mock('../MediaViewerContextMenu', () => ({
  MediaViewerContextMenu: ({ children }: { children: import('react').ReactNode }) => children,
}));

jest.mock('@/services/files/attachment-copy.service', () => ({
  copyAttachment: jest.fn(), copyImageUri: jest.fn(),
}));


it('keeps the selected video and rotation policy through viewport changes without scroll realignment', () => {
  mockLoaded = true;
  mockItems = [neighbour('older'), { ...focus, isVideo: true }, neighbour('newer')];
  render();
  expect(platform.screenOrientation.setVideoActive).toHaveBeenLastCalledWith(true);
  const video = () => renderer!.root.findByType(MediaVideoPage);
  expect(video().props.active).toBe(true);
  mockWidth = 844; mockHeight = 390;
  render();
  expect(renderer!.root.findByType(MediaTouchPager).props.pageKey).toBe(focusKey);
  expect(renderer!.root.findAllByType(FlatList)).toHaveLength(0);
  expect(mockScrollToOffset).not.toHaveBeenCalled();
  expect(video().props.active).toBe(true);
  expect(platform.screenOrientation.setVideoActive).toHaveBeenCalledTimes(1);
  expect(platform.screenOrientation.setVideoActive).toHaveBeenLastCalledWith(true);
  act(() => renderer!.unmount());
  renderer = undefined;
  expect(platform.screenOrientation.setVideoActive).toHaveBeenLastCalledWith(false);
});

jest.mock('@/components/chat/AttachmentTransferProgress', () => ({ AttachmentTransferProgress: () => null }));
