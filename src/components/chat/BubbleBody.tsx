import dayjs from 'dayjs';
import Check from 'lucide-react-native/icons/check';
import { memo, useMemo } from 'react';
import { Platform, StyleSheet, Text, View } from 'react-native';

import {
  InteractivePressable as Pressable,
  isInteractiveHovered,
} from '@/components/common/InteractivePressable';

import { AppText } from '@/components/common/AppText';
import { CustomEmojiImage } from '@/components/emoji/CustomEmojiImage';
import { useIsRTL } from '@/i18n/direction';
import { splitCustomEmojiText } from '@/lib/emoji/custom-message';
import {
  prepareMessagePresentation,
  type PreparedMessagePresentation,
} from '@/lib/chat/message-presentation';
import type { FileAttachmentMeta } from '@/lib/nostr/file-tags';
import { IS_ELECTRON } from '@/lib/platform';
import type { MessageSegment } from '@/lib/text/message-segments';
import { platform } from '@/platform';
import type { NearbyAttachmentFetchContext } from '@/services/files/file-attachment.service';
import { useDelivery, type MessageDelivery } from '@/stores/delivery-status.store';
import { iconStrokeWidth } from '@/theme/icons';
import { emojiSize, radius, shadow, spacing, useThemeColors } from '@/theme';

import { AttachmentAudio } from './AttachmentAudio';
import { AttachmentFile } from './AttachmentFile';
import { AttachmentImage } from './AttachmentImage';
import { AttachmentVideo } from './AttachmentVideo';
import { BUBBLE_PADDING_HORIZONTAL, BUBBLE_PADDING_VERTICAL } from './bubble-layout';
import { DeferredRemoteContent } from './DeferredRemoteContent';
import { EmbeddedMediaBlock } from './embedded-media';
import { EventReferenceCard } from './EventReferenceCard';
import { InvoiceBubble } from './InvoiceBubble';
import { MESSAGE_DELIVERY_ICON_SIZE, MessageDeliveryStatus } from './MessageDeliveryStatus';
import { MessageMetaOverlay } from './MessageMetaOverlay';
import type { MessageBubbleReplyPreview } from './MessageBubble';
import { MentionCard } from './MentionCard';
import { MentionText } from './MentionText';
import { QuotedReply } from './QuotedReply';
import {
  attachmentExceedsAutoDownloadLimit,
  messageRemoteContentMode,
  remoteContentPolicy,
  type RemoteContentMode,
} from './remote-content-policy';

export type { RemoteContentMode } from './remote-content-policy';

/** Open a tapped link in the system browser; ignore a malformed URL. */
function openUrl(href: string) {
  void platform.urlOpener.openExternalUrl(href).catch(() => {});
}

type Props = {
  content: string;
  tags?: string[][] | null;
  isSelf: boolean;
  createdAt: number;
  orderAt?: number;
  /** Rumor id — used to look up live delivery status (self bubbles only). */
  rumorId?: string;
  /** Persisted delivery (DB) — fallback when there's no live entry. */
  persistedDelivery?: MessageDelivery | null;
  replyTo?: MessageBubbleReplyPreview | null;
  attachment?: FileAttachmentMeta | null;
  /** Hide the in-bubble timestamp + delivery glyph. Used by the long-press
   * `MessageActionMenu` for a **clipped** lifted copy — a truncated preview that
   * fades out before its end has no business showing a (cut-off) send time. */
  hideMeta?: boolean;
  /** Square off the top / bottom corners. The long-press lifted copy sets these
   * on the edge it **clips** so the cut reads as a flat slice of the bubble, not
   * the bubble's own rounded corner peeking into the fade. */
  squareTop?: boolean;
  squareBottom?: boolean;
  /** This message's conversation key — lets an image attachment open the
   * swipeable conversation media pager (absent on the lifted long-press copy). */
  conversationKey?: string;
  proximity?: boolean;
  /** Auto-load trusted content, silently hold during transitions, or require
   * explicit intent for non-contact content. */
  remoteContentMode?: RemoteContentMode;
  /** Tap the quoted reply preview → scroll to the referenced message. */
  onPressReply?: () => void;
  /** Tap the meta row → open the per-relay delivery sheet (own messages). */
  onShowDelivery?: () => void;
  /** Preserve the measured outer frame while absorbing Android's one-pixel
   * fixed-width rounding in the invisible metadata spacer. */
  liftedCopy?: boolean;
  /** Cache-warmed pure render model; omitted callers reuse the same id cache. */
  presentation?: PreparedMessagePresentation;
};

type BubbleBodyBaseProps = Props & {
  liveDelivery: MessageDelivery | null;
};

// Spacer characters (written as escapes so an editor can't silently turn the
// wide figure-space into a narrow ASCII space — see blockMetaSpacer below).
const ZWSP = '\u200b'; // zero-width space — lets the line break before the spacer
const RLI = '\u2067'; // keeps an appended numeric spacer at logical end in RTL text
const PDI = '\u2069';
const MESSAGE_META_GAP = 2;
const MESSAGE_META_HOVER_OPACITY = 0.82;
const MESSAGE_META_PRESSED_OPACITY = 0.5;
const FIG = ' '; // figure space — width of a digit, approximates the icon gap
const HAN_SCRIPT = /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/;
const ANDROID_HAN_BASELINE_STYLE = { transform: [{ translateY: -2 }] } as const;
type InlineMessageSegment = Exclude<MessageSegment, { type: 'event' }>;

/**
 * The visual core of a message bubble — the coloured rounded card with its
 * (optional) quoted reply, body (text or attachment), and the in-bubble
 * timestamp + delivery glyph. Shared by `MessageBubble` (in the list, wrapped in
 * the swipe/long-press gestures) and by the long-press `MessageActionMenu`
 * (the lifted copy floated over the blurred backdrop), so the lifted bubble is
 * pixel-identical to the one in the list — including live delivery status.
 */
function BubbleBodyBase({
  content,
  tags,
  isSelf,
  createdAt,
  orderAt,
  rumorId,
  persistedDelivery,
  replyTo,
  attachment,
  hideMeta,
  squareTop,
  squareBottom,
  conversationKey,
  proximity = false,
  remoteContentMode: conversationMode = 'hold',
  onPressReply,
  onShowDelivery,
  liftedCopy = false,
  presentation: preparedPresentation,
  liveDelivery,
}: BubbleBodyBaseProps) {
  const c = useThemeColors();
  const isRTL = useIsRTL();

  // Live delivery (this session) wins; else the persisted (DB) status survives
  // restarts. null for incoming messages or ones that were never tracked.
  const delivery = liveDelivery ?? persistedDelivery ?? null;
  // Our own messages always reserve the status slot (even before a delivery
  // record loads), so the bubble width never shifts when the glyph appears.

  const bubbleBg = isSelf ? c.accent : c.surface;
  const textColor = isSelf ? c.accentForeground : c.text;
  // Links use accent (DESIGN §2); on the accent-filled own bubble that would
  // vanish, so there the white foreground carries them — the underline is the
  // shared affordance either way.
  const linkColor = isSelf ? c.accentForeground : c.accent;
  const presentation = useMemo(
    () =>
      preparedPresentation ??
      prepareMessagePresentation({
        messageId: rumorId,
        kind: attachment ? 15 : 14,
        content,
        tags,
      }),
    [attachment, content, preparedPresentation, rumorId, tags],
  );
  const customEmojiMap = presentation.customEmojiMap;
  const shortCustomEmojis = presentation.shortCustomEmojis;
  const shortEmoji = presentation.shortEmoji;
  const shortEmojiContent = shortEmoji?.content ?? null;
  const remoteContentMode = messageRemoteContentMode(conversationMode, isSelf);
  const contentPolicy = remoteContentPolicy(remoteContentMode);
  const attachmentNeedsExplicitDownload = attachment
    ? attachmentExceedsAutoDownloadLimit(attachment)
    : false;
  const attachmentAutoDownload =
    remoteContentMode === 'auto' && !attachmentNeedsExplicitDownload;
  const showAttachmentLoadPrompt =
    remoteContentMode === 'request' ||
    (remoteContentMode === 'auto' && attachmentNeedsExplicitDownload);
  // Split the body into text / URL / mention / event spans once per content change.
  // Most messages have no link or mention → a single text segment, rendered as
  // a plain string (no spans).
  const segments = presentation.segments;
  const embeddedMedia = contentPolicy.recognizeEmbeddedMedia
    ? presentation.embeddedMedia
    : new Map();
  const contentBlocks = contentPolicy.recognizeEmbeddedMedia
    ? presentation.contentBlocksWithMedia
    : presentation.contentBlocksWithoutMedia;
  // When the whole (trimmed) message is just one nostr mention, render a
  // profile name card instead of text.
  const cardPubkey = presentation.cardPubkey;
  const invoice = presentation.invoice;
  const invoiceDescription = presentation.invoiceDescription;
  const time = dayjs.unix(createdAt).format('HH:mm');
  const androidHanBaselineStyle =
    Platform.OS === 'android' && HAN_SCRIPT.test(content)
      ? ANDROID_HAN_BASELINE_STYLE
      : undefined;
  // Metadata sits inside the bubble (Signal/Telegram style). Colour matches the
  // bubble it's painted on: translucent white on the accent bubble, muted grey
  // on a surface bubble / over the page.
  const onBubbleColor = isSelf ? 'rgba(255,255,255,0.72)' : c.textMuted;
  /** Timestamp + (own) delivery glyph, tinted for whatever it's painted on. The
   * whole row is the tap target for the delivery sheet (not just the icon). */
  function renderMeta(color: string, overMedia = false) {
    const row = (
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: MESSAGE_META_GAP }}>
        <AppText
          variant="caption"
          weight="regular"
          selectable={false}
          style={[
            {
              color,
              fontSize: 11,
              lineHeight: 14,
              includeFontPadding: false,
              textAlignVertical: 'center',
            },
            overMedia ? shadow.mediaText : undefined,
          ]}
        >
          {time}
        </AppText>
        {isSelf ? (
          delivery ? (
            <MessageDeliveryStatus delivery={delivery} color={color} />
          ) : (
            // No delivery record (not yet loaded, or never tracked): show a
            // check so the status slot always has an icon — the width never
            // shifts when the real status later lands.
            <Check strokeWidth={iconStrokeWidth.compact} size={MESSAGE_DELIVERY_ICON_SIZE} color={color} />
          )
        ) : null}
      </View>
    );
    // Tapping the meta opens the message-info sheet — available for every
    // message once a handler is wired. Even an own message with no delivery
    // record (e.g. imported history, or before delivery is tracked) still has a
    // useful sheet: the send time, the raw rumor JSON, and any attachment info.
    if (!onShowDelivery) return row;
    return (
      <Pressable
        onPress={onShowDelivery}
        hitSlop={6}
        style={(state) => ({
          opacity: isInteractiveHovered(state)
            ? MESSAGE_META_HOVER_OPACITY
            : state.pressed
              ? MESSAGE_META_PRESSED_OPACITY
              : 1,
        })}
      >
        {row}
      </Pressable>
    );
  }

  /** The shared inset metadata capsule used over media and large emoji. */
  function renderOverlayMeta() {
    if (hideMeta) return null;
    return (
      <MessageMetaOverlay>
        {renderMeta(c.onOverlay, true)}
      </MessageMetaOverlay>
    );
  }

  function renderTextBubble(
    bodySegments: InlineMessageSegment[],
    options: {
      showReply: boolean;
      showMeta: boolean;
      squareTop?: boolean;
      squareBottom?: boolean;
    },
  ) {
    return (
      <View
        style={{
          backgroundColor: bubbleBg,
          paddingVertical: BUBBLE_PADDING_VERTICAL,
          paddingHorizontal: BUBBLE_PADDING_HORIZONTAL,
          // A clipped lifted copy squares the cut edge so the slice is flat — the
          // bubble's own rounded corner must not peek into the fade.
          borderTopStartRadius: options.squareTop ? 0 : radius.lg,
          borderTopEndRadius: options.squareTop ? 0 : radius.lg,
          borderBottomStartRadius: options.squareBottom ? 0 : radius.lg,
          borderBottomEndRadius: options.squareBottom ? 0 : radius.lg,
          // Quote-to-text gap: 4 (tighter than the 6px block-stacking gap used
          // when prose mixes with reference/media cards) — 6 read too distant.
          gap: 4,
        }}
      >
        {options.showReply && replyTo ? (
          <QuotedReply
            senderName={replyTo.senderDisplayName ?? 'Unknown'}
            contentPreview={replyTo.contentPreview}
            tone={isSelf ? 'onAccent' : 'neutral'}
            onPress={onPressReply}
            // With a quote, the top is a special case: the bubble's 6px top
            // padding is tighter than its 10px sides, so the card gets an extra
            // 4 to make its gap to the bubble's top edge match the sides.
            style={{ marginTop: 4 }}
          />
        ) : null}
        {renderInlineText(bodySegments, options.showMeta)}
      </View>
    );
  }

  function renderInlineText(bodySegments: InlineMessageSegment[], showMeta: boolean) {
    const metaWidthSpacer = isSelf ? `${FIG}${FIG}${FIG}${time}` : `${FIG}${time}`;
    const blockMetaSpacer = showMeta
      ? `${ZWSP}${isRTL ? `${RLI}${metaWidthSpacer}${PDI}` : metaWidthSpacer}`
      : '';
    const liftedSpacerLetterSpacing =
      liftedCopy && blockMetaSpacer.length > 1
        ? -StyleSheet.hairlineWidth / (blockMetaSpacer.length - 1)
        : undefined;

    const containsCustomEmoji = customEmojiMap.size > 0 && bodySegments.some(
      (segment) =>
        segment.type === 'text' &&
        splitCustomEmojiText(segment.value, customEmojiMap).some((part) => part.type === 'emoji'),
    );

    if (containsCustomEmoji) {
      return (
        <View style={{ gap: spacing.xs }}>
          <View
            style={{
              flexDirection: 'row',
              flexWrap: 'wrap',
              alignItems: 'center',
              gap: spacing.xs,
            }}
          >
            {bodySegments.flatMap((segment, segmentIndex) => {
              if (segment.type === 'url') {
                return [
                  <AppText
                    key={`url:${segmentIndex}`}
                    variant="message"
                    selectable={IS_ELECTRON}
                    onPress={() => openUrl(segment.href)}
                    style={{
                      color: linkColor,
                      textDecorationLine: 'underline',
                      includeFontPadding: false,
                      textAlignVertical: 'center',
                    }}
                  >
                    {segment.value}
                  </AppText>,
                ];
              }
              if (segment.type === 'mention') {
                return [
                  <MentionText key={`mention:${segmentIndex}`} pubkey={segment.pubkey} color={linkColor} />,
                ];
              }
              return splitCustomEmojiText(segment.value, customEmojiMap).map((part, partIndex) =>
                part.type === 'emoji' ? (
                  <DeferredRemoteContent
                    key={`emoji:${segmentIndex}:${partIndex}:${part.emoji.url}`}
                    mode={remoteContentMode}
                    url={part.emoji.url}
                  >
                    {(localUri) => (
                      <CustomEmojiImage
                        sourceUri={localUri}
                        emoji={part.emoji}
                        size={emojiSize.inlineImage}
                        hoverFeedback={false}
                      />
                    )}
                  </DeferredRemoteContent>
                ) : (
                  <AppText
                    key={`text:${segmentIndex}:${partIndex}`}
                    variant="message"
                    selectable={IS_ELECTRON}
                    style={{
                      color: textColor,
                      flexShrink: 1,
                      includeFontPadding: false,
                      textAlignVertical: 'center',
                      ...(Platform.OS === 'android' && HAN_SCRIPT.test(part.value)
                        ? ANDROID_HAN_BASELINE_STYLE
                        : undefined),
                    }}
                  >
                    {part.value}
                  </AppText>
                ),
              );
            })}
          </View>
          {showMeta ? <View style={{ alignSelf: 'flex-end' }}>{renderMeta(onBubbleColor)}</View> : null}
        </View>
      );
    }

    return (
      // One fixed layout, no measurement: a transparent spacer (ZWSP-prefixed
      // so it can break) reserves the meta's room at the end of the text; the
      // meta is pinned bottom-end. A short message keeps it inline on its
      // single line; when the last line is full only the spacer (carrying the
      // meta) wraps to its own line — the text never reflows.
      <View style={{ position: 'relative' }}>
        <AppText
          variant="message"
          selectable={IS_ELECTRON}
          style={[
            {
              color: textColor,
              includeFontPadding: false,
              textAlignVertical: 'center',
            },
            androidHanBaselineStyle,
          ]}
        >
          {bodySegments.length === 1 && bodySegments[0].type === 'text'
            ? bodySegments[0].value
            : bodySegments.map((seg, i) =>
                seg.type === 'url' ? (
                  <Text
                    key={i}
                    onPress={() => openUrl(seg.href)}
                    style={{ color: linkColor, textDecorationLine: 'underline' }}
                  >
                    {seg.value}
                  </Text>
                ) : seg.type === 'mention' ? (
                  <MentionText key={i} pubkey={seg.pubkey} color={linkColor} />
                ) : (
                  <Text key={i}>{seg.value}</Text>
                ),
              )}
          {/* Paint the spacer in the bubble's own background colour, not
              opacity:0 / color:'transparent' — Android mishandles both on a
              nested <Text> span, leaking this spacer as a visible ghost of the
              real timestamp beneath it. A solid colour that matches the backdrop
              is always honoured and is invisible against the bubble. */}
          <Text
            selectable={false}
            style={{
              fontSize: 11,
              lineHeight: 14,
              color: bubbleBg,
              includeFontPadding: false,
              textAlignVertical: 'center',
              letterSpacing: liftedSpacerLetterSpacing,
            }}
          >
            {blockMetaSpacer}
          </Text>
        </AppText>
        {showMeta ? (
          <View
            style={{
              position: 'absolute',
              end: liftedCopy ? -StyleSheet.hairlineWidth : 0,
              bottom: 0,
            }}
          >
            {renderMeta(onBubbleColor)}
          </View>
        ) : null}
      </View>
    );
  }

  const isMedia =
    !!attachment?.mime &&
    (attachment.mime.startsWith('image/') || attachment.mime.startsWith('video/'));
  const nearbyAttachment: NearbyAttachmentFetchContext | undefined =
    proximity && !isSelf && conversationKey && rumorId && tags
      ? { peerPubkey: conversationKey, rumorId, tags }
      : undefined;

  if (attachment) {
    return (
      <View style={{ gap: 6 }}>
        {replyTo ? (
          <QuotedReply
            senderName={replyTo.senderDisplayName ?? 'Unknown'}
            contentPreview={replyTo.contentPreview}
            onPress={onPressReply}
          />
        ) : null}

        <View
          style={{
            position: 'relative',
            // A wider quote must not stretch the media's metadata anchor.
            alignSelf: isMedia ? (isSelf ? 'flex-end' : 'flex-start') : undefined,
          }}
        >
          {attachment.mime?.startsWith('video/') ? (
            <AttachmentVideo
              meta={attachment}
              isSelf={isSelf}
              overlay={renderOverlayMeta()}
              messageId={rumorId}
              nearby={nearbyAttachment}
            />
          ) : attachment.mime?.startsWith('image/') ? (
            <AttachmentImage
              meta={attachment}
              isSelf={isSelf}
              overlay={renderOverlayMeta()}
              conversationKey={conversationKey}
              messageId={rumorId}
              orderAt={orderAt}
              autoDownload={attachmentAutoDownload}
              showLoadPrompt={showAttachmentLoadPrompt}
              nearby={nearbyAttachment}
            />
          ) : attachment.mime?.startsWith('audio/') ? (
            <AttachmentAudio
              meta={attachment}
              isSelf={isSelf}
              autoDownload={attachmentAutoDownload}
              showLoadPrompt={showAttachmentLoadPrompt}
              metaSlot={hideMeta ? undefined : renderMeta(onBubbleColor)}
              nearby={nearbyAttachment}
              messageId={rumorId}
            />
          ) : (
            <AttachmentFile
              meta={attachment}
              isSelf={isSelf}
              metaSlot={hideMeta ? undefined : renderMeta(c.textMuted)}
              nearby={nearbyAttachment}
              messageId={rumorId}
            />
          )}
        </View>
      </View>
    );
  }

  if (shortCustomEmojis) {
    return (
      <View style={{ gap: spacing.xs }}>
        {replyTo ? (
          <QuotedReply
            senderName={replyTo.senderDisplayName ?? 'Unknown'}
            contentPreview={replyTo.contentPreview}
            onPress={onPressReply}
          />
        ) : null}
        <View
          style={{
            position: 'relative',
            alignSelf: 'flex-end',
            flexDirection: 'row',
            gap: spacing.xs,
          }}
        >
          {shortCustomEmojis.map((emoji, index) => (
            <DeferredRemoteContent
              key={`${emoji.shortcode}:${emoji.url}:${index}`}
              mode={remoteContentMode}
              url={emoji.url}
            >
              {(localUri) => (
                <CustomEmojiImage
                  sourceUri={localUri}
                  emoji={emoji}
                  size={
                    shortCustomEmojis.length === 1
                      ? emojiSize.singleMessageImage
                      : emojiSize.messageImage
                  }
                  hoverFeedback={false}
                />
              )}
            </DeferredRemoteContent>
          ))}
          {renderOverlayMeta()}
        </View>
      </View>
    );
  }

  // One to three emoji are the message itself, not text inside a container:
  // enlarge them directly on the chat canvas and float the media metadata chip
  // over their bottom-end corner. A reply stays as a neutral quote card above.
  if (shortEmojiContent) {
    return (
      <View style={{ gap: spacing.xs }}>
        {replyTo ? (
          <QuotedReply
            senderName={replyTo.senderDisplayName ?? 'Unknown'}
            contentPreview={replyTo.contentPreview}
            onPress={onPressReply}
          />
        ) : null}
        <View style={{ position: 'relative', alignSelf: 'flex-end' }}>
          <AppText
            selectable={IS_ELECTRON}
            style={shortEmoji?.count === 1 ? emojiSize.singleMessage : emojiSize.message}
          >
            {shortEmojiContent}
          </AppText>
          {renderOverlayMeta()}
        </View>
      </View>
    );
  }

  // Whole-message mention → a standalone profile name card (its own bubble
  // style). Skipped when it's also a reply, which keeps the quoted-reply card
  // and renders the mention inline in a normal text bubble instead.
  if (cardPubkey && !replyTo) {
    return (
      <MentionCard
        loadRemote={remoteContentMode !== 'hold'}
        pubkey={cardPubkey}
        metaSlot={hideMeta ? undefined : renderMeta(c.textMuted)}
      />
    );
  }

  if (invoice) {
    return (
      <View
        style={{
          backgroundColor: bubbleBg,
          paddingVertical: BUBBLE_PADDING_VERTICAL,
          paddingHorizontal: BUBBLE_PADDING_HORIZONTAL,
          borderTopStartRadius: squareTop ? 0 : radius.lg,
          borderTopEndRadius: squareTop ? 0 : radius.lg,
          borderBottomStartRadius: squareBottom ? 0 : radius.lg,
          borderBottomEndRadius: squareBottom ? 0 : radius.lg,
          gap: spacing.sm,
        }}
      >
        {replyTo ? (
          <QuotedReply
            senderName={replyTo.senderDisplayName ?? 'Unknown'}
            contentPreview={replyTo.contentPreview}
            tone={isSelf ? 'onAccent' : 'neutral'}
            onPress={onPressReply}
            // With a quote, the top is a special case: the bubble's 6px top
            // padding is tighter than its 10px sides, so the card gets an extra
            // 4 to make its gap to the bubble's top edge match the sides.
            style={{ marginTop: 4 }}
          />
        ) : null}
        <InvoiceBubble
          invoice={invoice}
          isSelf={isSelf}
          messageDescription={invoiceDescription}
          metaSlot={hideMeta ? undefined : renderMeta(onBubbleColor)}
        />
      </View>
    );
  }

  if (contentBlocks) {
    const soleBlock = contentBlocks.length === 1 ? contentBlocks[0] : null;

    // When no prose or quote surrounds the reference, the event card itself is
    // the message bubble. Mixed content uses one coloured bubble below.
    if (soleBlock?.type === 'event' && !replyTo) {
      return (
        <EventReferenceCard
          loadRemote={remoteContentMode !== 'hold'}
          downloadMode={remoteContentMode}
          reference={soleBlock.reference}
          metaSlot={hideMeta ? undefined : renderMeta(c.textMuted)}
        />
      );
    }

    if (soleBlock?.type === 'media' && !replyTo) {
      const media = embeddedMedia.get(soleBlock.href);
      if (media) {
        return (
          <EmbeddedMediaBlock
            media={media}
            isSelf={isSelf}
            conversationKey={conversationKey}
            messageId={rumorId}
            createdAt={createdAt}
            orderAt={orderAt ?? createdAt * 1000}
            loadRemote={contentPolicy.loadRemoteMedia}
            overlayMetaSlot={hideMeta ? undefined : renderMeta(c.onOverlay, true)}
            audioMetaSlot={hideMeta ? undefined : renderMeta(onBubbleColor)}
          />
        );
      }
    }

    return (
      <View
        style={{
          backgroundColor: bubbleBg,
          paddingVertical: BUBBLE_PADDING_VERTICAL,
          paddingHorizontal: BUBBLE_PADDING_HORIZONTAL,
          borderTopStartRadius: squareTop ? 0 : radius.lg,
          borderTopEndRadius: squareTop ? 0 : radius.lg,
          borderBottomStartRadius: squareBottom ? 0 : radius.lg,
          borderBottomEndRadius: squareBottom ? 0 : radius.lg,
          gap: 6,
        }}
      >
        {replyTo ? (
          <QuotedReply
            senderName={replyTo.senderDisplayName ?? 'Unknown'}
            contentPreview={replyTo.contentPreview}
            tone={isSelf ? 'onAccent' : 'neutral'}
            onPress={onPressReply}
            // With a quote, the top is a special case: the bubble's 6px top
            // padding is tighter than its 10px sides, so the card gets an extra
            // 4 to make its gap to the bubble's top edge match the sides.
            style={{ marginTop: 4 }}
          />
        ) : null}

        {contentBlocks.map((block, index) => {
          if (block.type === 'event') {
            return (
              <EventReferenceCard
                key={`${block.reference.bech32}:${index}`}
                loadRemote={remoteContentMode !== 'hold'}
                downloadMode={remoteContentMode}
                reference={block.reference}
              />
            );
          }

          if (block.type === 'media') {
            const media = embeddedMedia.get(block.href);
            return media ? (
              <EmbeddedMediaBlock
                key={`${block.href}:${index}`}
                media={media}
                isSelf={isSelf}
                nested
                conversationKey={conversationKey}
                messageId={rumorId}
                createdAt={createdAt}
                orderAt={orderAt ?? createdAt * 1000}
                loadRemote={contentPolicy.loadRemoteMedia}
              />
            ) : null;
          }

          return (
            <View key={`text:${index}`}>
              {renderInlineText(block.segments, false)}
            </View>
          );
        })}

        {!hideMeta ? (
          <View style={{ alignSelf: 'flex-end' }}>{renderMeta(onBubbleColor)}</View>
        ) : null}
      </View>
    );
  }

  return renderTextBubble(segments as InlineMessageSegment[], {
    showReply: true,
    showMeta: !hideMeta,
    squareTop,
    squareBottom,
  });
}

function areBubbleBodyPropsEqual(a: Props, b: Props): boolean {
  const aReply = a.replyTo;
  const bReply = b.replyTo;
  return (
    a.content === b.content &&
    a.tags === b.tags &&
    a.isSelf === b.isSelf &&
    a.createdAt === b.createdAt &&
    a.orderAt === b.orderAt &&
    a.rumorId === b.rumorId &&
    a.persistedDelivery === b.persistedDelivery &&
    a.attachment === b.attachment &&
    a.hideMeta === b.hideMeta &&
    a.squareTop === b.squareTop &&
    a.squareBottom === b.squareBottom &&
    a.conversationKey === b.conversationKey &&
    a.proximity === b.proximity &&
    a.remoteContentMode === b.remoteContentMode &&
    a.liftedCopy === b.liftedCopy &&
    a.presentation === b.presentation &&
    aReply?.senderPubkey === bReply?.senderPubkey &&
    aReply?.senderDisplayName === bReply?.senderDisplayName &&
    aReply?.contentPreview === bReply?.contentPreview
  );
}

function OwnBubbleBody(props: Props) {
  const liveDelivery = useDelivery(props.rumorId ?? '');
  return <BubbleBodyBase {...props} liveDelivery={liveDelivery} />;
}

function BubbleBodyWithScopedDelivery(props: Props) {
  return props.isSelf ? (
    <OwnBubbleBody {...props} />
  ) : (
    <BubbleBodyBase {...props} liveDelivery={null} />
  );
}

/** Selection-mode chrome can update every mounted row without rebuilding the
 * expensive attachment/text subtree. Callback identity is deliberately ignored. */
export const BubbleBody = memo(BubbleBodyWithScopedDelivery, areBubbleBodyPropsEqual);
