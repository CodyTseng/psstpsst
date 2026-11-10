import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { Image } from 'expo-image';
import { VideoView } from 'expo-video';
import { StyleSheet, View } from 'react-native';

import { useThemeColors } from '@/theme';
import { VideoSurface } from '../VideoSurface';

jest.mock('expo-image', () => ({ Image: () => null }));
jest.mock('expo-video', () => ({ VideoView: () => null }));
let mockScheme: 'light' | 'dark' = 'light';
jest.mock('@/stores/theme.store', () => ({
  useThemeStore: (selector: (value: { accent: 'blue'; preference: 'light' | 'dark' }) => unknown) =>
    selector({ accent: 'blue', preference: mockScheme }),
}));

let renderer: ReactTestRenderer;
const cover = () => renderer.root.findAllByType(View).filter((node) => node.props.testID === 'video-first-frame-cover');
afterEach(() => act(() => renderer?.unmount()));

it.each(['light', 'dark'] as const)('retains an opaque cover until the first frame in %s mode', (scheme) => {
  mockScheme = scheme;
  let background: string;
  function Surface() {
    background = useThemeColors().surfaceMuted;
    return <VideoSurface sourceKey="video" thumbhash="preview" />;
  }
  act(() => { renderer = create(<Surface />); });
  expect(StyleSheet.flatten(cover()[0].props.style).backgroundColor).toBe(background!);
  expect(renderer.root.findByType(Image).props.placeholder).toEqual({ thumbhash: 'preview' });
  const firstFrame = renderer.root.findByType(VideoView).props.onFirstFrameRender;
  act(() => { firstFrame(); });
  expect(cover()).toHaveLength(0);
  act(() => { firstFrame(); });
  expect(cover()).toHaveLength(0);
});

it('resets for a new source and ignores the previous view completing late', () => {
  act(() => { renderer = create(<VideoSurface sourceKey="old" />); });
  const oldFrame = renderer.root.findByType(VideoView).props.onFirstFrameRender;
  act(() => renderer.update(<VideoSurface sourceKey="new" />));
  act(() => { oldFrame(); });
  expect(cover()).toHaveLength(1);
  act(() => { renderer.root.findByType(VideoView).props.onFirstFrameRender(); });
  expect(cover()).toHaveLength(0);
});

it('does not restore the cover when a poster arrives after the first frame', () => {
  act(() => { renderer = create(<VideoSurface sourceKey="video" />); });
  act(() => { renderer.root.findByType(VideoView).props.onFirstFrameRender(); });
  act(() => renderer.update(<VideoSurface sourceKey="video" posterUri="file:///poster.jpg" />));
  expect(cover()).toHaveLength(0);
});
