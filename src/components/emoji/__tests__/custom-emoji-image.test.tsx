import { Image } from 'expo-image';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { useCachedImages } from '@/hooks/use-cached-images';
import { useThemeColors } from '@/theme';

import { CustomEmojiImage } from '../CustomEmojiImage';

jest.mock('expo-image', () => ({ Image: () => null }));
jest.mock('@/hooks/use-cached-images', () => ({ useCachedImages: jest.fn() }));
jest.mock('@/stores/custom-emoji-detail.store', () => ({ showCustomEmojiDetail: jest.fn() }));
jest.mock('@/components/common/IconButton', () => ({ IconButton: () => null }));
jest.mock('@/theme', () => ({ spacing: { xl: 24 }, useThemeColors: jest.fn() }));

const emoji = { shortcode: 'wave', url: 'https://example.com/wave.png' };

describe('custom emoji loading feedback', () => {
  let renderer: ReactTestRenderer;
  const render = (uri?: string | null, loadRemote = true) => (
    <CustomEmojiImage emoji={emoji} size={16} clickable={false} sourceUri={uri} loadRemote={loadRemote} />
  );
  const placeholder = () => renderer.root.findAllByType(View)
    .map((view) => StyleSheet.flatten(view.props.style))
    .find((style) => style.backgroundColor);

  beforeEach(() => {
    jest.mocked(useCachedImages).mockReturnValue([
      { url: emoji.url, uri: null, checked: false, failed: false },
    ]);
    jest.mocked(useThemeColors).mockReturnValue({ surfaceMuted: 'grey', textMuted: 'muted' } as never);
  });
  afterEach(() => act(() => renderer?.unmount()));

  it.each(['light-grey', 'dark-grey'])('keeps the %s placeholder through download and decoding', (colour) => {
    jest.mocked(useThemeColors).mockReturnValue({ surfaceMuted: colour, textMuted: 'muted' } as never);
    act(() => { renderer = create(render()); });
    expect(placeholder()?.backgroundColor).toBe(colour);
    expect(renderer.root.findByType(ActivityIndicator).props.color).toBe('muted');
    act(() => { renderer.update(render('file:///wave.png')); });
    expect(renderer.root.findAllByType(ActivityIndicator)).toHaveLength(1);
    act(() => { renderer.root.findByType(Image).props.onDisplay(); });
    expect(placeholder()).toBeUndefined();
    expect(renderer.root.findAllByType(ActivityIndicator)).toHaveLength(0);
    act(() => { renderer.update(render('file:///next.png')); });
    expect(renderer.root.findAllByType(ActivityIndicator)).toHaveLength(1);
  });

  it('stops spinning after download or decoding fails', () => {
    jest.mocked(useCachedImages).mockReturnValue([
      { url: emoji.url, uri: null, checked: true, failed: true },
    ]);
    act(() => { renderer = create(render()); });
    expect(renderer.root.findAllByType(ActivityIndicator)).toHaveLength(0);
    expect(placeholder()?.backgroundColor).toBe('grey');
    act(() => { renderer.update(render('file:///broken.png')); });
    act(() => { renderer.root.findByType(Image).props.onError(); });
    expect(renderer.root.findAllByType(ActivityIndicator)).toHaveLength(0);
    expect(placeholder()?.backgroundColor).toBe('grey');
  });

  it('keeps deferred downloads static but shows decoding feedback for cached images', () => {
    act(() => { renderer = create(render(null, false)); });
    expect(renderer.root.findAllByType(ActivityIndicator)).toHaveLength(0);
    expect(placeholder()?.backgroundColor).toBe('grey');
    act(() => { renderer.update(render('file:///wave.png', false)); });
    expect(renderer.root.findAllByType(ActivityIndicator)).toHaveLength(1);
  });
});
