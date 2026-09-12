import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { withTiming } from 'react-native-reanimated';

import { MediaViewer, SingleImageLightbox } from '@/components/common/MediaViewer';
import { MediaViewerTopBar } from '../MediaViewerTopBar';
import { useMediaViewerTransition } from '../use-media-viewer-transition';
import { useMediaViewerStore } from '@/stores/media-viewer.store';
import { mediaViewerTiming } from '@/theme/motion';

jest.mock('react-native-reanimated', () => {
  const React = jest.requireActual('react') as typeof import('react');
  const { View } = jest.requireActual('react-native');
  return {
    __esModule: true,
    default: { View },
    useSharedValue: (value: number) => React.useRef({ value }).current,
    useAnimatedStyle: (factory: () => { opacity: number }) => ({ get opacity() { return factory().opacity; } }),
    withTiming: jest.fn((value: number) => value),
    cancelAnimation: jest.fn(),
    runOnJS: (callback: unknown) => callback,
    Easing: { out: (ease: unknown) => ease, cubic: (x: number) => x * x * x },
    ReduceMotion: { System: 'system' },
  };
});
jest.mock('@/components/common/ZoomableImage', () => ({ ZoomableImage: () => null }));
jest.mock('../MediaViewerTopBar', () => ({ MediaViewerTopBar: () => null }));
jest.mock('../MediaPager', () => ({ MediaPager: () => null }));
jest.mock('@/services/files/media-save.service', () => ({ saveUriToLibrary: jest.fn() }));
jest.mock('@/platform', () => ({ platform: {} }));
jest.mock('@/theme', () => ({ useThemeColors: () => ({ lightboxBackdrop: 'black' }) }));
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));

function Probe(_props: { transition: ReturnType<typeof useMediaViewerTransition> }) { return null; }
function Harness({ onClosed, dragOpacity }: { onClosed: () => void; dragOpacity?: { value: number } }) {
  // Only the value is consumed; this test does not model native shared-value listeners.
  const transition = useMediaViewerTransition(onClosed, dragOpacity as Parameters<typeof useMediaViewerTransition>[1]);
  return <Probe transition={transition} />;
}

let renderer: ReactTestRenderer | undefined;
let frames: FrameRequestCallback[];
const onClosed = jest.fn();
const transition = () => renderer!.root.findByType(Probe).props.transition as ReturnType<typeof useMediaViewerTransition>;
function flushFrame() { act(() => { frames.splice(0).forEach((frame) => frame(0)); }); }
function lastExit() {
  const call = jest.mocked(withTiming).mock.calls.filter((args) => args[1] === mediaViewerTiming.exit).at(-1)!;
  return call[2]!;
}

beforeEach(() => {
  jest.clearAllMocks();
  frames = [];
  jest.spyOn(global, 'requestAnimationFrame').mockImplementation((callback) => { frames.push(callback); return frames.length; });
  jest.spyOn(global, 'cancelAnimationFrame').mockImplementation(() => {});
  useMediaViewerStore.setState({ target: null, sessionId: 0 });
});
afterEach(() => {
  act(() => renderer?.unmount());
  renderer = undefined;
  jest.restoreAllMocks();
});

it('starts transparent and preserves drag opacity while fading in', () => {
  act(() => { renderer = create(<Harness onClosed={onClosed} dragOpacity={{ value: 0.6 }} />); });
  expect((transition().animatedStyle as unknown as { opacity: number }).opacity).toBe(0);
  expect(withTiming).not.toHaveBeenCalled();
  flushFrame();
  expect((transition().animatedStyle as unknown as { opacity: number }).opacity).toBe(0.6);
  expect(mediaViewerTiming.enter.reduceMotion).toBe('system');
  expect(mediaViewerTiming.exit.reduceMotion).toBe('system');
});

it('finishes dismissal before releasing the viewer and navigating, exactly once', () => {
  const order: string[] = [];
  act(() => { renderer = create(<Harness onClosed={() => order.push('closed')} />); });
  flushFrame();
  act(() => {
    transition().requestClose(() => order.push('navigate'));
    transition().requestClose(() => order.push('duplicate'));
  });
  expect(transition().isClosing).toBe(true);
  expect(order).toEqual([]);
  const finish = lastExit();
  act(() => { finish(false); });
  expect(order).toEqual([]);
  act(() => { finish(true); finish(true); });
  expect(order).toEqual(['closed', 'navigate']);
});

it('does not restart entrance when closed before the first frame', () => {
  act(() => { renderer = create(<Harness onClosed={onClosed} />); });
  act(() => { transition().requestClose(); });
  flushFrame();
  expect(jest.mocked(withTiming).mock.calls.some(([value]) => value === 1)).toBe(false);
  act(() => { lastExit()(true); });
  expect(onClosed).toHaveBeenCalledTimes(1);
});

it('discards a pending close and navigation after the viewer is unmounted', () => {
  const navigate = jest.fn();
  act(() => { renderer = create(<Harness onClosed={onClosed} />); });
  flushFrame();
  act(() => { transition().requestClose(navigate); });
  const finish = lastExit();
  act(() => { renderer!.unmount(); });
  renderer = undefined;
  act(() => { finish(true); });
  expect(onClosed).not.toHaveBeenCalled();
  expect(navigate).not.toHaveBeenCalled();
});

it('keeps a single-image viewer in the store until its fade-out completes', () => {
  useMediaViewerStore.getState().open('image.png');
  act(() => { renderer = create(<MediaViewer />); });
  flushFrame();
  act(() => { renderer!.root.findByType(MediaViewerTopBar).props.onClose(); });
  expect(useMediaViewerStore.getState().target).not.toBeNull();
  expect(renderer!.root.findAllByType(SingleImageLightbox)).toHaveLength(1);
  act(() => { lastExit()(true); });
  expect(useMediaViewerStore.getState().target).toBeNull();
  expect(renderer!.toJSON()).toBeNull();
});

it('reopens the same URI as a fresh session and ignores the previous close callback', () => {
  useMediaViewerStore.getState().open('image.png');
  act(() => { renderer = create(<MediaViewer />); });
  flushFrame();
  act(() => { renderer!.root.findByType(MediaViewerTopBar).props.onClose(); });
  const finishOld = lastExit();
  act(() => { useMediaViewerStore.getState().open('image.png'); });
  flushFrame();
  act(() => { finishOld(true); });
  expect(useMediaViewerStore.getState().target).toEqual({ mode: 'single', uri: 'image.png' });
  expect(useMediaViewerStore.getState().sessionId).toBe(2);
  act(() => { renderer!.root.findByType(MediaViewerTopBar).props.onClose(); });
  act(() => { lastExit()(true); });
  expect(useMediaViewerStore.getState().target).toBeNull();
});

it('releases deferred media work only after a completed entrance', () => {
  act(() => { renderer = create(<Harness onClosed={onClosed} />); });
  flushFrame();
  const finish = jest.mocked(withTiming).mock.calls.find(([value]) => value === 1)![2]!;
  expect(transition().entered).toBe(false);
  act(() => { finish(false); });
  expect(transition().entered).toBe(false);
  act(() => { finish(true); });
  expect(transition().entered).toBe(true);
});

it('does not release deferred work if dismissal overtakes entrance completion', () => {
  act(() => { renderer = create(<Harness onClosed={onClosed} />); });
  flushFrame();
  const finish = jest.mocked(withTiming).mock.calls.find(([value]) => value === 1)![2]!;
  act(() => { transition().requestClose(); finish(true); });
  expect(transition().entered).toBe(false);
});
