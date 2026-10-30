import { act, create, type ReactTestRenderer } from 'react-test-renderer';

import { StyleSheet } from 'react-native';
import { AppText } from '@/components/common/AppText';
import { createThemePalettes, type ThemeColors } from '@/theme/palette';
import { MessageDeliveryStatus } from '../MessageDeliveryStatus';

import { BubbleBody } from '../BubbleBody';
import { DeferredRemoteContent } from '../DeferredRemoteContent';
import { MentionCard } from '../MentionCard';
import { EventReferenceCard } from '../EventReferenceCard';

jest.mock('lucide-react-native/icons/check', () => ({ __esModule: true, default: () => null }));
jest.mock('../AttachmentAudio', () => ({ AttachmentAudio: () => null }));
jest.mock('../AttachmentFile', () => ({ AttachmentFile: () => null }));
jest.mock('../AttachmentImage', () => ({ AttachmentImage: () => null }));
jest.mock('../AttachmentVideo', () => ({ AttachmentVideo: () => null }));
jest.mock('../embedded-media', () => ({ EmbeddedMediaBlock: () => null }));
jest.mock('../open-message-url', () => ({ openMessageUrl: jest.fn() }));
jest.mock('../EventReferenceCard', () => ({ EventReferenceCard: () => null }));
jest.mock('../InvoiceBubble', () => ({ InvoiceBubble: () => null }));
jest.mock('../MentionCard', () => ({ MentionCard: () => null }));
jest.mock('../MentionText', () => ({ MentionText: () => null }));
jest.mock('../QuotedReply', () => ({ QuotedReply: () => null }));
jest.mock('../MessageDeliveryStatus', () => ({ MessageDeliveryStatus: () => null }));
jest.mock('../MessageMetaOverlay', () => ({ MessageMetaOverlay: () => null }));
jest.mock('@/components/emoji/CustomEmojiImage', () => ({ CustomEmojiImage: () => null }));
jest.mock('@/components/common/AppText', () => ({ AppText: () => null }));
jest.mock('@/components/common/AppButton', () => ({ AppButton: () => null }));
jest.mock('@/platform', () => ({ platform: {} }));
jest.mock('@/stores/delivery-status.store', () => ({ useDelivery: () => null }));
jest.mock('@/i18n/direction', () => ({ useIsRTL: () => false }));
jest.mock('@/lib/chat/message-presentation', () => ({ prepareMessagePresentation: jest.fn() }));
let mockColors: ThemeColors | undefined;
jest.mock('@/theme', () => ({
  ...jest.requireActual('@/theme'),
  useThemeColors: () => mockColors ?? {},
}));
jest.mock('@/stores/theme.store', () => ({ useThemeStore: () => 'light' }));

it.each(['profile', 'event', 'mixed-event'])('never replaces %s metadata with a download gate', (type) => {
  const eventBlock = { type: 'event', reference: { bech32: 'note-test', relays: [] } };
  const blocks = type === 'mixed-event'
    ? [eventBlock, { type: 'text', segments: [{ type: 'text', value: 'Text' }] }]
    : [eventBlock];
  const presentation = {
    cardPubkey: type === 'profile' ? 'a'.repeat(64) : null,
    customEmojiMap: new Map(),
    embeddedMedia: new Map(),
    contentBlocksWithMedia: blocks,
    contentBlocksWithoutMedia: blocks,
  };
  let renderer!: ReactTestRenderer;
  const render = (mode: 'hold' | 'request' | 'auto') => (
    <BubbleBody content="" isSelf={false} createdAt={0} hideMeta
      remoteContentMode={mode} presentation={presentation as never} />
  );
  act(() => { renderer = create(render('hold')); });
  const component = type === 'profile' ? MentionCard : EventReferenceCard;
  const card = renderer.root.findByType(component);
  expect(card.props.loadRemote).toBe(false);
  for (const mode of ['request', 'auto', 'request'] as const) {
    act(() => { renderer.update(render(mode)); });
    expect(renderer.root.findByType(component)).toBe(card);
    expect(card.props.loadRemote).toBe(true);
    expect(renderer.root.findAllByType(DeferredRemoteContent)).toHaveLength(0);
    if (type !== 'profile') expect(card.props.downloadMode).toBe(mode);
  }
  act(() => renderer.unmount());
});

it.each([
  ['light', 'blue'], ['dark', 'blue'], ['light', '#FFFF00'], ['dark', '#FFFF00'],
] as const)('uses the shared metadata foreground for %s/%s own messages', (scheme, accent) => {
  const c = createThemePalettes(accent === '#FFFF00' ? { light: { color: accent, foreground: 'black' } } : accent)[scheme];
  mockColors = c;
  const presentation = {
    segments: [{ type: 'text', value: 'Hello' }],
    cardPubkey: null, customEmojiMap: new Map(), embeddedMedia: new Map(),
    contentBlocksWithMedia: [], contentBlocksWithoutMedia: [],
  };
  let renderer!: ReactTestRenderer;
  act(() => { renderer = create(<BubbleBody content="Hello" isSelf createdAt={0}
    persistedDelivery={{ status: 'sent' } as never} presentation={presentation as never} />); });
  const time = renderer.root.findAllByType(AppText).find((node) => typeof node.props.children === 'string' && /^\d{2}:\d{2}$/.test(node.props.children));
  expect(time).toBeDefined();
  expect(StyleSheet.flatten(time!.props.style).color).toBe(c.accentForegroundMuted);
  expect(renderer.root.findByType(MessageDeliveryStatus).props.color).toBe(c.accentForegroundMuted);
  act(() => renderer.unmount());
  mockColors = undefined;
});
