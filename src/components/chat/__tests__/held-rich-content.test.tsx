import { Image } from 'expo-image';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { Dimensions, StyleSheet, View } from 'react-native';

import { AppButton } from '@/components/common/AppButton';
import { Avatar } from '@/components/common/Avatar';
import { EmojiPackAuthorRow } from '@/components/emoji/EmojiPackAuthorRow';
import { EmojiPackReferenceCard } from '@/components/emoji/EmojiPackReferenceCard';
import { getEmojiPack } from '@/services/emoji/custom-emoji.service';
import { CustomEmojiImage } from '@/components/emoji/CustomEmojiImage';
import { useDisplayName } from '@/hooks/use-display-name';
import { darkPalette, lightPalette } from '@/theme';

import { DeferredRemoteContent } from '../DeferredRemoteContent';
import { MentionCard } from '../MentionCard';

jest.mock('@/services/emoji/custom-emoji.service', () => ({ getEmojiPack: jest.fn() }));
jest.mock('@/components/common/DirectionalChevron', () => ({ DirectionalChevron: () => null }));
jest.mock('@/i18n/direction', () => ({ useLanguageDirection: () => 'ltr' }));
jest.mock('@/hooks/use-cached-images', () => ({
  useCachedImages: (urls: string[], allowed: boolean) => urls.map((url) => ({
    url, uri: allowed ? `file:///cached/${url}` : null, checked: true, failed: false,
  })),
}));
jest.mock('@/platform', () => ({ platform: {} }));
jest.mock('@/stores/theme.store', () => ({
  useThemeStore: (selector: (state: { accent: 'blue'; preference: 'light' }) => unknown) =>
    selector({ accent: 'blue', preference: 'light' }),
}));
jest.mock('expo-image', () => ({ Image: () => null }));
jest.mock('expo-router', () => ({ router: { push: jest.fn() } }));
jest.mock('@/components/common/Avatar', () => ({ Avatar: () => null }));
jest.mock('@/components/common/AppButton', () => ({ AppButton: () => null }));
jest.mock('@/components/common/AppText', () => ({ AppText: () => null }));
jest.mock('@/stores/custom-emoji-detail.store', () => ({ showCustomEmojiDetail: jest.fn() }));
jest.mock('@/hooks/use-display-name', () => ({ useDisplayName: jest.fn() }));
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
jest.mock('@/theme', () => ({
  ...jest.requireActual('@/theme'),
  useThemeColors: jest.fn(),
}));

const { useThemeColors } = jest.requireMock('@/theme');
const emoji = { shortcode: 'wave', url: 'https://example.com/wave.png' };

it.each([lightPalette, darkPalette])('keeps emoji and identity geometry while remote work is held', (palette) => {
  useThemeColors.mockReturnValue(palette);
  jest.mocked(useDisplayName).mockReturnValue({
    name: 'Alice',
    profile: { picture: 'https://example.com/avatar.png' } as never,
  });
  const render = (mode: 'hold' | 'auto') => (
    <>
      <DeferredRemoteContent mode={mode} url={emoji.url}>
        {(uri) => <CustomEmojiImage emoji={emoji} size={96} clickable={false} sourceUri={uri} />}
      </DeferredRemoteContent>
      <MentionCard pubkey={'a'.repeat(64)} interactive={false} loadRemote={mode !== 'hold'} />
    </>
  );
  let renderer!: ReactTestRenderer;
  act(() => { renderer = create(render('hold')); });
  const image = renderer.root.findByType(Image);
  const avatar = renderer.root.findByType(Avatar);
  const cardFrame = renderer.root.findAllByType(View).find(
    (node) => StyleSheet.flatten(node.props.style)?.width === 260,
  )!;
  expect(cardFrame).toBeDefined();
  const frameStyle = cardFrame.props.style;
  expect(image.props.source).toBeUndefined();
  expect(image.props.style).toEqual({ width: 96, height: 96 });
  expect(avatar.props.picture).toBeUndefined();
  expect(useDisplayName).toHaveBeenLastCalledWith('a'.repeat(64), false);
  act(() => { renderer.update(render('auto')); });
  expect(renderer.root.findByType(Image)).toBe(image);
  expect(image.props.source).toEqual({ uri: `file:///cached/${emoji.url}` });
  expect(image.props.style).toEqual({ width: 96, height: 96 });
  expect(renderer.root.findAllByType(View)).toContain(cardFrame);
  expect(cardFrame.props.style).toEqual(frameStyle);
  expect(avatar.props.picture).toBe('https://example.com/avatar.png');
  expect(useDisplayName).toHaveBeenLastCalledWith('a'.repeat(64), true);
  act(() => renderer.unmount());
});


it.each([0, 1, 5, 6, 10, 12, null])('reserves two pack rows and its heading before loading %s stickers', async (count) => {
  useThemeColors.mockReturnValue(lightPalette);
  jest.mocked(useDisplayName).mockReturnValue({ name: 'Alice', profile: null });
  jest.mocked(getEmojiPack).mockResolvedValue(count === null ? null : {
    authorPubkey: 'a'.repeat(64),
    title: 'Pack title',
    emojis: Array.from({ length: count }, (_, index) => ({ ...emoji, shortcode: `emoji${index}` })),
  } as never);
  const render = (loadRemote: boolean) => (
    <EmojiPackReferenceCard authorPubkey={'a'.repeat(64)} identifier="pack" loadRemote={loadRemote} />
  );
  let renderer!: ReactTestRenderer;
  act(() => { renderer = create(render(false)); });
  const cells = () => renderer.root.findAllByType(View).filter(
    (node) => StyleSheet.flatten(node.props.style)?.aspectRatio === 1,
  );
  const initialCells = cells();
  expect(initialCells).toHaveLength(10);
  expect(renderer.root.findAllByType(Avatar)).toHaveLength(1);
  expect(renderer.root.findAllByType(Image)).toHaveLength(0);
  await act(async () => { renderer.update(render(true)); });
  expect(cells()).toEqual(initialCells);
  expect(renderer.root.findAllByType(Avatar)).toHaveLength(1);
  expect(renderer.root.findAllByType(Image)).toHaveLength(Math.min(count ?? 0, 10));
  act(() => renderer.unmount());
});


it.each([1, 1.5, 2])('keeps a non-collapsing title line at font scale %s', (fontScale) => {
  const originalWindow = Dimensions.get('window');
  Dimensions.set({ window: { ...originalWindow, fontScale } });
  useThemeColors.mockReturnValue(lightPalette);
  jest.mocked(useDisplayName).mockReturnValue({ name: 'Alice', profile: null });
  const render = (title?: string) => (
    <EmojiPackAuthorRow
      authorPubkey={'a'.repeat(64)}
      packTitle={title}
      titleVariant="caption"
      prominentTitle
      withVerticalPadding={false}
      loadRemote={false}
    />
  );
  let renderer!: ReactTestRenderer;
  try {
    act(() => { renderer = create(render()); });
    const heading = renderer.root.findAllByType(View)[0];
    const initialHeight = StyleSheet.flatten(heading.props.style).height;
    expect(typeof initialHeight).toBe('number');
    expect(initialHeight).toBeGreaterThan(0);
    for (const title of ['Sticker pack', '猫咪表情包', '🐱🐶', '']) {
      act(() => { renderer.update(render(title)); });
      expect(StyleSheet.flatten(heading.props.style).height).toBe(initialHeight);
    }
    act(() => { Dimensions.set({ window: { ...originalWindow, fontScale: fontScale + 1 } }); });
    expect(StyleSheet.flatten(heading.props.style).height).toBeGreaterThan(initialHeight);
  } finally {
    act(() => renderer?.unmount());
    Dimensions.set({ window: originalWindow });
  }
});


it('loads stranger pack metadata while holding artwork until a tap', async () => {
  useThemeColors.mockReturnValue(lightPalette);
  jest.mocked(useDisplayName).mockReturnValue({ name: 'Alice', profile: null });
  jest.mocked(getEmojiPack).mockClear().mockResolvedValue({
    authorPubkey: 'a'.repeat(64), title: 'Sticker pack', emojis: [emoji],
  } as never);
  let renderer!: ReactTestRenderer;
  await act(async () => {
    renderer = create(<EmojiPackReferenceCard authorPubkey={'a'.repeat(64)} identifier="stranger-pack" downloadMode="request" />);
  });
  expect(getEmojiPack).toHaveBeenCalledTimes(1);
  expect(renderer.root.findByType(EmojiPackAuthorRow).props.packTitle).toBe('Sticker pack');
  const cells = renderer.root.findAllByType(View).filter(
    (node) => StyleSheet.flatten(node.props.style)?.aspectRatio === 1,
  );
  expect(cells).toHaveLength(10);
  const image = renderer.root.findByType(Image);
  expect(image.props.source).toBeUndefined();
  const stopPropagation = jest.fn();
  act(() => { renderer.root.findByType(AppButton).props.onPress({ stopPropagation }); });
  expect(stopPropagation).toHaveBeenCalledTimes(1);
  expect(image.props.source).toEqual({ uri: `file:///cached/${emoji.url}` });
  expect(renderer.root.findAllByType(AppButton)).toHaveLength(0);
  expect(renderer.root.findAllByType(View)).toEqual(expect.arrayContaining(cells));
  act(() => renderer.unmount());
});
