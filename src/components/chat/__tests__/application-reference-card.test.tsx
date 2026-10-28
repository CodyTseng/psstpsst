import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { router } from 'expo-router';
import { Dimensions, StyleSheet, Text, View } from 'react-native';
import { AppText } from '@/components/common/AppText';
import { AppCard } from '@/components/common/AppCard';
import { AppButton } from '@/components/common/AppButton';
import { InteractivePressable } from '@/components/common/InteractivePressable';
import { ApplicationIcon } from '@/components/napplet/ApplicationIcon';
import { useApplicationReference } from '@/hooks/use-application-reference';
import { useReferencedEvent } from '@/hooks/use-referenced-event';
import { EmojiPackReferenceCard } from '@/components/emoji/EmojiPackReferenceCard';
import { getEmojiPack } from '@/services/emoji/custom-emoji.service';
import { darkPalette, lightPalette, typography } from '@/theme';
import { ApplicationReferenceCard } from '../ApplicationReferenceCard';
import { EventReferenceCard } from '../EventReferenceCard';
import { MessageCardFooter } from '../MessageCardFooter';
import { MessageCard } from '../MessageCard';
import { MessageCardHeader, MessageCardText } from '../MessageCardHeader';
import { MentionCard } from '../MentionCard';
import { MessageCardSource } from '../MessageCardSource';

let mockScheme = 'light';
jest.mock('expo-router', () => ({ router: { push: jest.fn() } }));
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
jest.mock('@/lib/time', () => ({ formatListTime: () => '' }));
jest.mock('@/i18n/direction', () => ({ getLanguageDirection: () => 'ltr', useIsRTL: () => false, useDirectionalIconStyle: () => ({}) }));
jest.mock('@/stores/theme.store', () => ({ useThemeStore: (select: (state: object) => unknown) => select({ preference: mockScheme, accent: 'blue' }) }));
jest.mock('@/hooks/use-application-reference', () => ({ useApplicationReference: jest.fn() }));
jest.mock('@/hooks/use-display-name', () => ({ useDisplayName: () => ({ name: 'Alice', profile: null }) }));
jest.mock('@/components/common/Avatar', () => ({ Avatar: () => null }));
jest.mock('@/components/napplet/ApplicationIcon', () => ({ ApplicationIcon: () => null }));
jest.mock('@/hooks/use-referenced-event', () => ({ useReferencedEvent: jest.fn() }));
jest.mock('@/services/explore/application-reference', () => ({ isApplicationReference: (reference: { kind: number }) => [5129, 15129, 35129, 15128, 35128, 35130].includes(reference.kind) }));
jest.mock('@/services/nostr/event-reference.service', () => ({ canResolveReferencedEvent: () => false }));
jest.mock('@/services/emoji/custom-emoji.service', () => ({ getEmojiPack: jest.fn() }));
jest.mock('@/hooks/use-cached-images', () => ({ useCachedImages: () => [] }));
jest.mock('@/components/emoji/CustomEmojiImage', () => ({ CustomEmojiImage: () => null }));
jest.mock('../open-message-url', () => ({ openMessageUrl: jest.fn() }));
jest.mock('@/stores/chat-prefs.store', () => ({ useChatPrefsStore: () => '' }));
jest.mock('@solar-icons/react-native/category/arrows/Linear/SquareArrowRightUp', () => ({ SquareArrowRightUp: () => null }), { virtual: true });

let renderer: ReactTestRenderer;
const reference = { kind: 35130, bech32: 'naddr-app', relays: [] };
const retry = jest.fn();
const entry = { title: 'Notes', description: 'Write your ideas', servers: [], manifest: { pubkey: 'a'.repeat(64) } };
beforeEach(() => { jest.clearAllMocks(); jest.mocked(useApplicationReference).mockReturnValue({ entry, loading: false, retry } as never); });
afterEach(() => { act(() => renderer?.unmount()); });

it.each([5129, 15129, 35129, 15128, 35128, 35130])('routes shared application kind %s into the unified card', kind => {
  act(() => { renderer = create(<EventReferenceCard reference={{ ...reference, kind }} metaSlot={<Text>12:00</Text>} />); });
  expect(renderer.root.findByType(ApplicationReferenceCard)).toBeDefined();
  const texts = renderer.root.findAllByType(AppText).map(node => node.props.children);
  expect(texts).toContain('Notes'); expect(texts).toContain('Write your ideas'); expect(texts).toContain('Alice');
  expect(renderer.root.findByType(MessageCardSource).findAllByType(AppText).map(node => node.props.children)).toContain('Alice');
  expect(renderer.root.findByType(MessageCardHeader).findByType(MessageCardSource)).toBeDefined();
  expect(renderer.root.findByType(MessageCardHeader).findAllByType(AppText).map(node => node.props.children)).not.toContain(entry.description);
  expect(texts).not.toContain('applications.details');
  const footer = renderer.root.findByType(MessageCardFooter);
  expect(footer.findAllByType(AppText).map(node => node.props.children)).toContain('chat.card_types.application');
  expect(renderer.root.findByType(MessageCardFooter).props.metaSlot).toBeDefined();
  act(() => { renderer.root.findByType(InteractivePressable).props.onPress(); });
  expect(router.push).toHaveBeenCalledWith({ pathname: '/explore-details', params: { address: reference.bech32 } });
});

it.each(['light', 'dark'])('uses themed surfaces and bounded descriptions in %s mode', scheme => {
  mockScheme = scheme;
  act(() => { renderer = create(<ApplicationReferenceCard reference={reference} />); });
  const card = renderer.root.findByType(AppCard);
  const frame = card.findByType(View);
  expect(StyleSheet.flatten(frame.props.style).backgroundColor).toBe((scheme === 'dark' ? darkPalette : lightPalette).surface);
  const description = renderer.root.findAllByType(AppText).find(node => node.props.children === entry.description)!;
  expect(description.props.numberOfLines).toBe(2);
});

it('preserves an application fallback and footer during loading and permits retry after failure', () => {
  jest.mocked(useApplicationReference).mockReturnValue({ entry: null, loading: true, retry });
  act(() => { renderer = create(<ApplicationReferenceCard reference={reference} metaSlot={<Text>12:00</Text>} />); });
  expect(renderer.root.findAllByType(AppText).map(node => node.props.children)).toContain('chat.event_reference.loading');
  expect(renderer.root.findAllByType(AppButton)).toHaveLength(0);
  jest.mocked(useApplicationReference).mockReturnValue({ entry: null, loading: false, retry });
  act(() => { renderer.update(<ApplicationReferenceCard reference={reference} metaSlot={<Text>12:00</Text>} />); });
  expect(renderer.root.findAllByType(AppText).map(node => node.props.children)).toContain('applications.app_title');
  const stopPropagation = jest.fn();
  act(() => { renderer.root.findByType(AppButton).props.onPress({ stopPropagation }); });
  expect(stopPropagation).toHaveBeenCalled(); expect(retry).toHaveBeenCalled();
  expect(renderer.root.findByType(MessageCardFooter).props.metaSlot).toBeDefined();
});

it('holds remote icon loading and navigation during a conversation transition', () => {
  act(() => { renderer = create(<ApplicationReferenceCard reference={reference} loadRemote={false} />); });
  expect(useApplicationReference).toHaveBeenLastCalledWith(reference, false);
  expect(renderer.root.findByType(ApplicationIcon).props.loadRemote).toBe(false);
  expect(renderer.root.findByType(InteractivePressable).props.disabled).toBe(true);
});

it.each(['light', 'dark'])('shares frame geometry and title hierarchy across all four card types in %s mode', async scheme => {
  mockScheme = scheme;
  jest.mocked(useReferencedEvent).mockReturnValue({ event: { kind: 1, pubkey: 'a'.repeat(64), created_at: 1, content: 'Short note' }, loading: false } as never);
  jest.mocked(getEmojiPack).mockResolvedValue({ authorPubkey: 'a'.repeat(64), title: 'Sticker pack', emojis: [] } as never);
  const meta = <Text>12:00</Text>;
  await act(async () => { renderer = create(<>
    <MentionCard pubkey={'a'.repeat(64)} metaSlot={meta} />
    <EventReferenceCard reference={{ ...reference, kind: 1 }} metaSlot={meta} />
    <ApplicationReferenceCard reference={reference} metaSlot={meta} />
    <EmojiPackReferenceCard authorPubkey={'a'.repeat(64)} identifier="pack" metaSlot={meta} />
  </>); });
  expect(renderer.root.findAllByType(MessageCard)).toHaveLength(4);
  const frames = renderer.root.findAllByType(AppCard).map(card => StyleSheet.flatten(card.findByType(View).props.style));
  expect(frames).toHaveLength(4);
  frames.forEach(frame => expect(frame).toEqual(frames[0]));
  for (const header of renderer.root.findAllByType(MessageCardHeader)) {
    const title = header.findAllByType(AppText)[0];
    expect(title.props).toMatchObject({ variant: 'body', weight: 'semibold', numberOfLines: 1 });
  }
  expect(renderer.root.findByType(EmojiPackReferenceCard).findByType(MessageCardHeader).props.visual).toBeUndefined();
  expect(renderer.root.findByType(EmojiPackReferenceCard).findAllByType(AppText).map(node => node.props.children)).not.toContain('emoji.emoji_count');
  for (const footer of renderer.root.findAllByType(MessageCardFooter)) expect(footer.props.metaSlot).toBe(meta);
  expect(renderer.root.findAllByType(MessageCardFooter).map(footer =>
    footer.findAllByType(AppText)[0].props.children)).toEqual([
    'chat.card_types.profile', 'chat.card_types.note', 'chat.card_types.application', 'chat.card_types.emoji_pack',
  ]);
  const texts = renderer.root.findAllByType(AppText).map(node => node.props.children);
  expect(texts).toContain('Short note');
  expect(texts).not.toContain('chat.view_profile');
  expect(texts).not.toContain('applications.open');
});

it.each([1, 2])('preserves application and note text geometry across loading, success and failure at font scale %s', fontScale => {
  const originalWindow = Dimensions.get('window');
  Dimensions.set({ window: { ...originalWindow, fontScale } });
  const render = () => <>
    <ApplicationReferenceCard reference={reference} />
    <EventReferenceCard reference={{ ...reference, kind: 1 }} />
  </>;
  const reservations = () => renderer.root.findAllByType(MessageCardText).map(text =>
    StyleSheet.flatten(text.findByType(AppText).props.style).minHeight);
  const sourceHeight = () => StyleSheet.flatten(renderer.root.findByType(MessageCardSource).findByType(View).props.style).minHeight;
  try {
    jest.mocked(useApplicationReference).mockReturnValue({ entry: null, loading: true, retry });
    jest.mocked(useReferencedEvent).mockReturnValue({ event: null, loading: true });
    act(() => { renderer = create(render()); });
    const pending = reservations();
    const pendingSourceHeight = sourceHeight();
    expect(pendingSourceHeight).toBeGreaterThan(0);
    expect(pending).toEqual([
      typography.body.lineHeight * fontScale * 2,
      typography.caption.lineHeight * fontScale,
      typography.body.lineHeight * fontScale * 4,
    ]);
    for (const text of ['Short', 'Long preview '.repeat(100), '']) {
      jest.mocked(useApplicationReference).mockReturnValue({ entry: { ...entry, description: text }, loading: false, retry } as never);
      jest.mocked(useReferencedEvent).mockReturnValue({ event: { kind: 1, pubkey: 'a'.repeat(64), created_at: 1, content: text }, loading: false } as never);
      act(() => { renderer.update(render()); });
      expect(reservations()).toEqual(pending);
      expect(sourceHeight()).toBe(pendingSourceHeight);
    }
    jest.mocked(useApplicationReference).mockReturnValue({ entry: null, loading: false, retry });
    jest.mocked(useReferencedEvent).mockReturnValue({ event: null, loading: false });
    act(() => { renderer.update(render()); });
    expect(reservations()).toEqual(pending);
    expect(sourceHeight()).toBe(pendingSourceHeight);
  } finally {
    act(() => renderer.unmount());
    Dimensions.set({ window: originalWindow });
  }
});
