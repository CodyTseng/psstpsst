import { act, create, type ReactTestRenderer } from 'react-test-renderer';

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
jest.mock('@/theme', () => ({
  ...jest.requireActual('@/theme'),
  useThemeColors: () => ({}),
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
