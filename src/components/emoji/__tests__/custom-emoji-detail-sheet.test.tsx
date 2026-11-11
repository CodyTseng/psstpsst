import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { StyleSheet } from 'react-native';

import { BottomSheet } from '@/components/common/BottomSheet';
import { IconButton } from '@/components/common/IconButton';
import { SingleImageLightbox } from '@/components/common/MediaViewer';
import { getEmojiPack } from '@/services/emoji/custom-emoji.service';
import { useCustomEmojiDetail } from '@/stores/custom-emoji-detail.store';
import type { EmojiPack } from '@/lib/nostr/custom-emoji';

import { CustomEmojiDetailSheet } from '../CustomEmojiDetailSheet';
import { CustomEmojiGrid } from '../custom-emoji-grid';

jest.mock('expo-router', () => ({ router: { push: jest.fn() } }));
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ bottom: 0 }) }));
jest.mock('@/platform', () => ({ platform: {} }));
jest.mock('@/services/crypto/nip17-gift-wrap', () => ({ KIND_CHAT: 14 }));
jest.mock('@/services/emoji/custom-emoji.service', () => ({ getEmojiPack: jest.fn() }));
jest.mock('@/hooks/use-custom-emojis', () => ({ useCustomEmojis: () => ({ packs: [], standalone: [] }) }));
jest.mock('@/stores/active-account.store', () => ({
  useActiveAccount: (selector: (state: { activePubkey: string }) => unknown) => selector({ activePubkey: 'alice' }),
}));
jest.mock('@/stores/forward-draft.store', () => ({
  useForwardDraftStore: (selector: (state: { start: () => void }) => unknown) => selector({ start: jest.fn() }),
}));
jest.mock('@/theme', () => ({
  useThemeColors: () => ({}), spacing: { lg: 16, xl: 24, '3xl': 48, md: 12 },
  radius: { full: 999 }, shadow: { float: {} }, emojiSize: { detailImage: 160 },
}));
jest.mock('@/components/common/BottomSheet', () => ({
  BottomSheet: ({ children, scrollOverlay, modalOverlay }: { children: React.ReactNode; scrollOverlay: React.ReactNode; modalOverlay: React.ReactNode }) => <>{children}{scrollOverlay}{modalOverlay}</>,
}));
jest.mock('@/components/common/AppButton', () => ({ AppButton: () => null }));
jest.mock('@/components/common/AppText', () => ({ AppText: () => null }));
jest.mock('@/components/common/IconButton', () => ({ IconButton: () => null }));
jest.mock('@/components/common/MediaViewer', () => ({ SingleImageLightbox: () => null }));
jest.mock('../CustomEmojiImage', () => ({ CustomEmojiImage: () => null }));
jest.mock('../custom-emoji-grid', () => ({ CustomEmojiGrid: () => null }));
jest.mock('../EmojiPackAuthorRow', () => ({ EmojiPackAuthorRow: () => null }));

it('keeps the current emoji preview accessible after its pack loads', async () => {
  const emoji = { shortcode: 'wave', url: 'https://example.com/wave.png', setAddress: '30030:alice:pack' };
  const otherEmoji = { shortcode: 'smile', url: 'https://example.com/smile.png' };
  let resolvePack!: (pack: EmojiPack) => void;
  jest.mocked(getEmojiPack).mockReturnValue(new Promise((resolve) => { resolvePack = resolve; }));
  useCustomEmojiDetail.getState().open(emoji);
  let renderer!: ReactTestRenderer;
  try {
    act(() => { renderer = create(<CustomEmojiDetailSheet />); });
    expect(renderer.root.findByType(BottomSheet).props.scrollOverlay).toBeUndefined();
    act(() => { renderer.root.findByType(IconButton).props.onPress(); });
    expect(renderer.root.findByType(SingleImageLightbox).props.uri).toBe(emoji.url);
    act(() => { renderer.root.findByType(SingleImageLightbox).props.onClose(); });

    await act(async () => {
      resolvePack({ coordinate: emoji.setAddress, authorPubkey: 'alice', emojis: [emoji, otherEmoji] } as EmojiPack);
    });
    const overlay = renderer.root.findByType(BottomSheet).props.scrollOverlay;
    const style = StyleSheet.flatten(overlay.props.style);
    // A full-viewport transparent overlay intercepts pointer input on RN Web.
    expect(style).toMatchObject({ position: 'absolute', bottom: 16 });
    expect(style.top).toBeUndefined();
    expect(style.height).toBeUndefined();
    act(() => { renderer.root.findByType(IconButton).props.onPress(); });
    expect(renderer.root.findByType(SingleImageLightbox).props).toMatchObject({ uri: emoji.url, inModal: true });
    act(() => { renderer.root.findByType(SingleImageLightbox).props.onClose(); });
    expect(renderer.root.findAllByType(SingleImageLightbox)).toHaveLength(0);
    expect(useCustomEmojiDetail.getState().emoji).toEqual(emoji);
    act(() => { renderer.root.findByType(CustomEmojiGrid).props.onSelect(otherEmoji); });
    expect(renderer.root.findByType(SingleImageLightbox).props.uri).toBe(otherEmoji.url);
    act(() => { renderer.root.findByType(SingleImageLightbox).props.onClose(); });
    expect(renderer.root.findAllByType(SingleImageLightbox)).toHaveLength(0);
    expect(useCustomEmojiDetail.getState().emoji).toEqual(emoji);
  } finally {
    act(() => renderer?.unmount());
    useCustomEmojiDetail.getState().close();
  }
});
