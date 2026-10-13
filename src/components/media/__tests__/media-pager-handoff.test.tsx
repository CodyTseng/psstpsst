import type { ComponentProps, ReactNode } from 'react';
import { Image, type ImageRef } from 'expo-image';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { FlatList, View } from 'react-native';

import { useAttachment } from '@/hooks/use-attachment';
import { useConversationMedia, type ConversationMediaItem } from '@/hooks/use-conversation-media';
import type { MediaViewerPreview } from '@/stores/media-viewer.store';
import { MediaPager } from '../MediaPager';
import { MediaTouchPager } from '../MediaTouchPager';
import { MediaPagerNavigation } from '../MediaPagerNavigation';
import { MediaPageFrame } from '../MediaPageFrame';
import { MediaVideoPage } from '../MediaVideoPage';
import { platform } from '@/platform';
import { MediaImagePlaceholder } from '@/components/common/MediaImagePlaceholder';
import { MediaDismissSurface } from '../MediaDismissSurface';

let mockWidth = 390;
let mockHeight = 844;
jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({
  __esModule: true, default: () => ({ width: mockWidth, height: mockHeight, scale: 1, fontScale: 1 }),
}));
let mockEntered = false;
let mockElectron = false;
let mockFrameReadyEffects = false;
let mockLoaded = false;
let mockItems: ConversationMediaItem[] = [];
let mockInstance = 0;
let mockCachedImages = new Map<string, ImageRef | string | null>();
const mockMounted = jest.fn();
const mockUnmounted = jest.fn();
const mockScrollToOffset = jest.fn();
const mockRequestClose = jest.fn();

jest.mock('../MediaPageFrame', () => {
  const React = jest.requireActual('react') as typeof import('react');
  const native = jest.requireActual('../MediaPageFrame') as typeof import('../MediaPageFrame');
  const web = jest.requireActual('../MediaPageFrame.web') as typeof import('../MediaPageFrame.web');
  return { MediaPageFrame: (props: ComponentProps<typeof native.MediaPageFrame>) =>
    React.createElement(mockFrameReadyEffects ? web.MediaPageFrame : native.MediaPageFrame, props) };
});

jest.mock('@/hooks/use-cached-media-images', () => ({ useCachedMediaImages: jest.fn(() => mockCachedImages) }));
jest.mock('expo-image', () => ({ Image: () => null }));
jest.mock('react-native-gesture-handler', () => ({
  ...jest.requireActual('react-native-gesture-handler'),
  GestureDetector: ({ children }: { children: ReactNode }) => children,
}));
jest.mock('expo-router', () => ({ router: { navigate: jest.fn() } }));
jest.mock('@solar-icons/react-native/category/messages/Linear/ChatRound', () => ({ ChatRound: () => null }), { virtual: true });
jest.mock('@solar-icons/react-native/category/video/Linear/GalleryWide', () => ({ GalleryWide: () => null }), { virtual: true });
jest.mock('lucide-react-native/icons/download', () => ({ __esModule: true, default: () => null }), { virtual: true });
jest.mock('lucide-react-native/icons/chevron-left', () => ({ __esModule: true, default: () => null }), { virtual: true });
jest.mock('lucide-react-native/icons/chevron-right', () => ({ __esModule: true, default: () => null }), { virtual: true });
jest.mock('@/components/common/IconButton', () => ({ IconButton: () => null }));
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
jest.mock('@/lib/platform', () => ({ get IS_ELECTRON() { return mockElectron; } }));
jest.mock('@/platform', () => ({ platform: { screenOrientation: { setVideoActive: jest.fn().mockResolvedValue(undefined) } } }));
jest.mock('@/services/files/media-save.service', () => ({ saveAttachmentToLibrary: jest.fn(), saveRemoteMediaToLibrary: jest.fn() }));
jest.mock('@/lib/attachments/failure', () => ({ revealOrRetry: jest.fn() }));
jest.mock('@/stores/active-account.store', () => ({ useActiveAccount: () => 'account' }));
jest.mock('@/theme', () => ({ useThemeColors: () => ({}), desktopChrome: { titlebarHeight: 32 }, uiDensity: {}, spacing: { lg: 16 } }));
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
  return { __esModule: true, default: { View: jest.requireActual('react-native').View, createAnimatedComponent: (component: unknown) => component },
    Easing: { out: () => (value: number) => value },
    ReduceMotion: { System: 'system' },
    LinearTransition: {
      duration() { return this; }, easing() { return this; }, reduceMotion() { return this; },
    },
    useAnimatedStyle: (factory: () => unknown) => factory(),
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
const image = () => renderer!.root.findAllByType('image').find((image) => image.props.uri === preview.uri)!;
const selectedImage = () => renderer!.root.findAllByType('image').find((image) => image.props.interactionEnabled)!;

beforeEach(() => {
  mockFrameReadyEffects = false;
  jest.clearAllMocks(); mockWidth = 390; mockHeight = 844; mockEntered = false; mockElectron = false; mockLoaded = false; mockItems = []; mockInstance = 0; mockCachedImages = new Map();
  jest.mocked(useAttachment).mockReturnValue({ state: { status: 'loading' } } as ReturnType<typeof useAttachment>);
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

it.each([false, true])('enables desktop snapping only after the distant clicked image is mounted (already loaded: %s)', (alreadyLoaded) => {
  mockElectron = true;
  const older = Array.from({ length: 50 }, (_, index) => neighbour(`older-${index}`));
  if (alreadyLoaded) { mockLoaded = true; mockItems = [...older, focus, neighbour('newer')]; }
  render();
  if (!alreadyLoaded) {
    mockLoaded = true; mockItems = [...older, focus, neighbour('newer')]; render();
  }
  const list = () => renderer!.root.findByType(FlatList);
  expect(list().props.initialScrollIndex).toBe(50);
  expect(list().props.pagingEnabled).toBe(true);
  expect(list().props.style).toEqual({ scrollSnapType: 'none' });
  expect(mockScrollToOffset).toHaveBeenLastCalledWith({ offset: mockWidth * 50, animated: false });
  const selectedFrame = renderer!.root.findAllByType(MediaPageFrame).find((frame) => frame.props.onReady)!;
  act(() => { selectedFrame.props.onReady(); });
  expect(list().props.pagingEnabled).toBe(true);
  expect(list().props.style).toBeUndefined();
  expect(selectedImage().props.uri).toBe(preview.uri);
});

it('repositions a gallery target before enabling desktop snapping without a chat preview', () => {
  mockElectron = true; mockLoaded = true;
  mockItems = [neighbour('older'), focus, neighbour('newer')];
  act(() => { renderer = create(<MediaPager conversationKey="chat" focusMessageId="focus" focusOrderAt={2}
    focusUrl={focusUrl} showGrid={false} onClose={jest.fn()} />); });
  expect(renderer!.root.findByType(FlatList).props.style).toEqual({ scrollSnapType: 'none' });
  expect(mockScrollToOffset).toHaveBeenLastCalledWith({ offset: mockWidth, animated: false });
  act(() => { renderer!.root.findAllByType(MediaPageFrame).find((frame) => frame.props.onReady)!.props.onReady(); });
  expect(renderer!.root.findByType(FlatList).props.pagingEnabled).toBe(true);
  expect(renderer!.root.findByType(FlatList).props.style).toBeUndefined();
});

function scrollDesktop(offset: number, width = mockWidth) {
  act(() => { renderer!.root.findByType(FlatList).props.onScroll({
    nativeEvent: { contentOffset: { x: offset, y: 0 }, layoutMeasurement: { width } },
  }); });
}

it('selects Electron images in both directions using only web scroll events', () => {
  mockElectron = true; mockLoaded = true;
  mockItems = [focus, neighbour('newer')];
  render();
  scrollDesktop(mockWidth * 0.6);
  expect(mockMounted.mock.calls.map(([uri]) => uri)).toEqual([preview.uri]);
  scrollDesktop(mockWidth);
  expect(selectedImage().props.uri).toBe('https://media.test/newer');
  scrollDesktop(0);
  expect(selectedImage().props.uri).toBe(preview.uri);
});

it('keeps consecutive desktop swipes active after the real web readiness effect without another scroll event', () => {
  mockElectron = true; mockFrameReadyEffects = true; mockLoaded = true;
  mockItems = [focus, neighbour('newer'), neighbour('newest')];
  render();
  expect(renderer!.root.findByType(FlatList).props.style).toBeUndefined();
  mockScrollToOffset.mockClear();
  // Each event represents RN Web's final debounced callback. The selected
  // frame then runs its actual layout effect; an aligned scroll emits nothing.
  scrollDesktop(mockWidth);
  expect(selectedImage().props.uri).toBe('https://media.test/newer');
  expect(mockScrollToOffset).not.toHaveBeenCalled();
  scrollDesktop(mockWidth * 2);
  expect(selectedImage().props.uri).toBe('https://media.test/newest');
  scrollDesktop(mockWidth);
  expect(selectedImage().props.uri).toBe('https://media.test/newer');
  scrollDesktop(0);
  expect(selectedImage().props.uri).toBe(preview.uri);
  expect(mockScrollToOffset).not.toHaveBeenCalled();
  expect(renderer!.root.findByType(FlatList).props.style).toBeUndefined();
});

it('selects and positions Electron pages immediately with repeated arrow actions', () => {
  mockElectron = true; mockLoaded = true;
  mockItems = [focus, neighbour('newer'), neighbour('newest')];
  render();
  const navigation = () => renderer!.root.findByType(MediaPagerNavigation);
  expect(navigation().props.hasPrevious).toBe(false);
  act(() => { navigation().props.onPage(1); });
  expect(selectedImage().props.uri).toBe('https://media.test/newer');
  expect(mockScrollToOffset).toHaveBeenLastCalledWith({ offset: mockWidth, animated: false });
  // No scroll event is required before the next key press.
  act(() => { navigation().props.onPage(1); });
  expect(selectedImage().props.uri).toBe('https://media.test/newest');
  expect(navigation().props.hasNext).toBe(false);
  scrollDesktop(mockWidth);
  expect(selectedImage().props.uri).toBe('https://media.test/newest');
  scrollDesktop(mockWidth * 2);
  act(() => { navigation().props.onPage(-1); });
  expect(selectedImage().props.uri).toBe('https://media.test/newer');
  act(() => { navigation().props.onPage(-1); });
  expect(selectedImage().props.uri).toBe(preview.uri);
  expect(mockScrollToOffset).toHaveBeenLastCalledWith({ offset: 0, animated: false });
});

it('keeps desktop arrow paging aligned after prepending older media', () => {
  mockElectron = true; mockLoaded = true;
  mockItems = [focus, neighbour('newer')]; render();
  mockItems = [neighbour('older'), ...mockItems]; render();
  act(() => { renderer!.root.findByType(MediaPagerNavigation).props.onPage(1); });
  expect(selectedImage().props.uri).toBe('https://media.test/newer');
  expect(mockScrollToOffset).toHaveBeenLastCalledWith({ offset: mockWidth * 2, animated: false });
});

it('ignores Electron positioning events and retains selection after prepends', () => {
  mockElectron = true;
  render();
  const instance = image().props.instance;
  mockLoaded = true; mockItems = [neighbour('older'), focus, neighbour('newer')];
  render();
  scrollDesktop(0);
  expect(image().props.instance).toBe(instance);
  scrollDesktop(mockWidth);
  mockItems = [neighbour('oldest'), ...mockItems];
  render();
  expect(mockScrollToOffset).toHaveBeenLastCalledWith({ offset: mockWidth * 2, animated: false });
  scrollDesktop(mockWidth);
  expect(image().props.instance).toBe(instance);
  scrollDesktop(mockWidth * 2);
  scrollDesktop(mockWidth * 3);
  expect(selectedImage().props.uri).toBe('https://media.test/newer');
});

it('retains the Electron selection during resizing and resumes web paging', () => {
  mockElectron = true; mockLoaded = true;
  mockItems = [focus, neighbour('newer'), neighbour('newest')];
  render();
  scrollDesktop(mockWidth);
  mockWidth = 780;
  render();
  scrollDesktop(390, 390);
  scrollDesktop(0);
  expect(selectedImage().props.uri).toBe('https://media.test/newer');
  act(() => { renderer!.root.findByType(FlatList).props.onLayout({ nativeEvent: { layout: { width: mockWidth } } }); });
  expect(mockScrollToOffset).toHaveBeenLastCalledWith({ offset: mockWidth, animated: false });
  scrollDesktop(mockWidth);
  scrollDesktop(mockWidth * 2);
  expect(selectedImage().props.uri).toBe('https://media.test/newest');
});

it('resumes Electron paging after resizing at offset zero without a scroll event', () => {
  mockElectron = true; mockLoaded = true;
  mockItems = [focus, neighbour('newer')];
  render();
  mockWidth = 780;
  render();
  act(() => { renderer!.root.findByType(FlatList).props.onLayout({ nativeEvent: { layout: { width: mockWidth } } }); });
  scrollDesktop(mockWidth);
  expect(selectedImage().props.uri).toBe('https://media.test/newer');
});

it('retains decoded Electron neighbour surfaces through selection without fetching remote bytes', () => {
  mockElectron = true; mockLoaded = true;
  const next = neighbour('newer');
  mockItems = [focus, next, neighbour('outside')];
  mockCachedImages.set(next.mediaKey, 'file:///cached-neighbour.jpg');
  render();
  const neighbourImage = renderer!.root.findAllByType('image').find((image) => image.props.uri === 'file:///cached-neighbour.jpg')!;
  const instance = neighbourImage.props.instance;
  expect(neighbourImage.props.interactionEnabled).toBe(false);
  expect(mockMounted.mock.calls.map(([uri]) => uri)).toEqual([preview.uri, 'file:///cached-neighbour.jpg']);
  scrollDesktop(mockWidth);
  expect(selectedImage().props.uri).toBe('file:///cached-neighbour.jpg');
  expect(selectedImage().props.instance).toBe(instance);
  scrollDesktop(0);
  expect(image().props.instance).toBe(mockMounted.mock.calls[0][1]);
});

it('prepares cached Electron attachments without downloading and retains their surface when selected', () => {
  mockElectron = true; mockLoaded = true;
  const next = { ...focus, mediaKey: 'next-attachment', messageId: 'next' };
  mockItems = [focus, next];
  mockCachedImages.set(next.mediaKey, 'file:///cached-attachment.jpg');
  render();
  const instance = renderer!.root.findAllByType('image').find((image) => image.props.uri === 'file:///cached-attachment.jpg')!.props.instance;
  expect(useAttachment).toHaveBeenLastCalledWith(next.meta, { autoLoad: false });
  scrollDesktop(mockWidth);
  expect(selectedImage().props.uri).toBe('file:///cached-attachment.jpg');
  expect(selectedImage().props.instance).toBe(instance);
  expect(useAttachment).toHaveBeenLastCalledWith(next.meta, { autoLoad: true });
});

it('retains a second cached desktop neighbour through consecutive snapped page selections', () => {
  mockElectron = true; mockLoaded = true;
  const next = neighbour('newer');
  const outer = neighbour('newest');
  mockItems = [focus, next, outer, neighbour('outside')];
  mockCachedImages.set(next.mediaKey, 'file:///next.jpg');
  mockCachedImages.set(outer.mediaKey, 'file:///outer.jpg');
  render();
  const instance = renderer!.root.findAllByType('image').find((image) => image.props.uri === 'file:///outer.jpg')!.props.instance;
  expect(renderer!.root.findByType(FlatList).props.windowSize).toBe(5);
  expect(renderer!.root.findAllByType(MediaPageFrame)).toHaveLength(mockItems.length);
  scrollDesktop(mockWidth);
  scrollDesktop(mockWidth * 2);
  expect(selectedImage().props.uri).toBe('file:///outer.jpg');
  expect(selectedImage().props.instance).toBe(instance);
  expect(mockUnmounted).not.toHaveBeenCalledWith('file:///outer.jpg', instance);
});

it('shows Electron neighbour previews during scrolling and local cache checks', () => {
  mockElectron = true; mockLoaded = true;
  const next = { ...focus, mediaKey: 'next-attachment', messageId: 'next',
    meta: { ...focus.meta, thumbhash: undefined, blurhash: 'fallback-preview' } } as ConversationMediaItem;
  mockItems = [focus, next];
  jest.mocked(useAttachment).mockReturnValue({ state: { status: 'checking' } } as ReturnType<typeof useAttachment>);
  render();
  expect(renderer!.root.findByType(MediaImagePlaceholder).props.blurhash).toBe('fallback-preview');
  expect(useAttachment).not.toHaveBeenCalled();
  scrollDesktop(mockWidth);
  expect(renderer!.root.findByType(MediaImagePlaceholder).props.blurhash).toBe('fallback-preview');
  expect(useAttachment).toHaveBeenLastCalledWith(next.meta, { autoLoad: true });
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

it('hands the cached neighbour bitmap to the selected page without a hash-only reload', () => {
  mockEntered = true; mockLoaded = true;
  const next = neighbour('newer');
  const decoded = { width: 1600, height: 900 } as ImageRef;
  mockItems = [focus, next];
  mockCachedImages.set(next.mediaKey, decoded);
  render();
  const pager = renderer!.root.findByType(MediaTouchPager);
  let neighbourRenderer: ReactTestRenderer;
  act(() => { neighbourRenderer = create(pager.props.next); });
  const retained = neighbourRenderer!.root.findByProps({ uri: next.meta.url });
  const instance = retained.props.instance;
  expect(retained.props.decodedImage).toBe(decoded);
  expect(retained.props.interactionEnabled).toBe(false);
  act(() => { pager.props.onPage(1); });
  act(() => { neighbourRenderer!.update(renderer!.root.findByType(MediaTouchPager).props.children); });
  const selected = neighbourRenderer!.root.findByProps({ uri: next.meta.url });
  expect(selected.props.instance).toBe(instance);
  expect(selected.props.interactionEnabled).toBe(true);
  act(() => neighbourRenderer!.unmount());
  expect(renderer!.root.findByProps({ uri: next.meta.url }).props.decodedImage).toBe(decoded);
});

it('fits undownloaded neighbours using embedded dimensions', () => {
  mockLoaded = true;
  const next = neighbour('newer');
  next.meta = { ...next.meta, width: 1600, height: 900, thumbhash: 'preview' } as typeof next.meta;
  mockItems = [focus, next];
  mockCachedImages.set(next.mediaKey, null);
  render();
  let neighbourRenderer: ReactTestRenderer;
  act(() => { neighbourRenderer = create(renderer!.root.findByType(MediaTouchPager).props.next); });
  expect(neighbourRenderer!.root.findByType(MediaImagePlaceholder).props.aspectRatio).toBe(1600 / 900);
  act(() => neighbourRenderer!.unmount());
});

it('fits a selected downloading attachment using its declared dimensions', () => {
  mockLoaded = true;
  const downloading = { ...focus, meta: { ...focus.meta, dim: '1600x900' } } as ConversationMediaItem;
  mockItems = [downloading];
  act(() => { renderer = create(<MediaPager conversationKey="chat" focusMessageId="focus" focusOrderAt={2}
    focusUrl={focusUrl} showGrid onClose={jest.fn()} />); });
  expect(renderer!.root.findByType(MediaImagePlaceholder).props.aspectRatio).toBe(1600 / 900);
});

it('retains cached attachment views and starts no neighbour download during promotion', () => {
  mockLoaded = true;
  const next = { ...focus, mediaKey: 'next-attachment', messageId: 'next' };
  const decoded = { width: 1600, height: 900 } as ImageRef;
  mockItems = [focus, next];
  mockCachedImages.set(next.mediaKey, decoded);
  render();
  let neighbourRenderer: ReactTestRenderer;
  act(() => { neighbourRenderer = create(renderer!.root.findByType(MediaTouchPager).props.next); });
  const instance = neighbourRenderer!.root.findByProps({ uri: next.meta.url }).props.instance;
  expect(useAttachment).toHaveBeenLastCalledWith(next.meta, { autoLoad: false });
  act(() => { renderer!.root.findByType(MediaTouchPager).props.onPage(1); });
  act(() => { neighbourRenderer!.update(renderer!.root.findByType(MediaTouchPager).props.children); });
  expect(neighbourRenderer!.root.findByProps({ uri: next.meta.url }).props.instance).toBe(instance);
  expect(useAttachment).toHaveBeenLastCalledWith(next.meta, { autoLoad: true });
  act(() => neighbourRenderer!.unmount());
});

it.each([
  { thumbhash: 'download-preview', blurhash: undefined },
  { thumbhash: undefined, blurhash: 'fallback-preview' },
])('retains $thumbhash / $blurhash from download completion until native display', (hashes) => {
  mockLoaded = true;
  mockItems = [{ ...focus, meta: { ...focus.meta, ...hashes, dim: '1600x900' } } as ConversationMediaItem];
  const element = <MediaPager conversationKey="chat" focusMessageId="focus" focusOrderAt={2}
    focusUrl={focusUrl} showGrid onClose={jest.fn()} />;
  act(() => { renderer = create(element); });
  expect(renderer!.root.findByType(MediaImagePlaceholder).props).toMatchObject({ ...hashes, aspectRatio: 16 / 9 });

  jest.mocked(useAttachment).mockReturnValue({ state: { status: 'ready', localUri: 'file:///downloaded.jpg' } } as ReturnType<typeof useAttachment>);
  act(() => { renderer!.update(<MediaPager {...element.props} />); });
  const readyImage = renderer!.root.findByType('image');
  expect(readyImage.props).toMatchObject({ ...hashes, uri: 'file:///downloaded.jpg', aspectRatio: 16 / 9 });
  expect(readyImage.props.decodedImage).toBeUndefined();

  // Exercise the real image component with the props produced by the ready transition.
  const { ZoomableImage: RealZoomableImage } = jest.requireActual('@/components/common/ZoomableImage') as typeof import('@/components/common/ZoomableImage');
  let displayRenderer!: ReactTestRenderer;
  try {
    act(() => { displayRenderer = create(<RealZoomableImage {...readyImage.props as ComponentProps<typeof RealZoomableImage>} />); });
    const placeholder = displayRenderer.root.findByType(MediaImagePlaceholder);
    act(() => { placeholder.findByType(View).props.onLayout({ nativeEvent: { layout: { width: 390, height: 844 } } }); });
    const hashImage = displayRenderer.root.findAllByType(Image).find((image) => image.props.placeholder);
    expect(hashImage?.props.placeholder).toEqual(hashes.thumbhash ? { thumbhash: hashes.thumbhash } : { blurhash: hashes.blurhash });
    expect(hashImage?.props.style).toEqual({ width: 390, height: 219.375 });
    const fullImage = displayRenderer.root.findAllByType(Image).find((image) => image.props.source?.uri === 'file:///downloaded.jpg')!;
    act(() => { fullImage.props.onDisplay(); });
    expect(displayRenderer.root.findAllByType(MediaImagePlaceholder)).toHaveLength(0);
  } finally {
    act(() => displayRenderer?.unmount());
  }
});
