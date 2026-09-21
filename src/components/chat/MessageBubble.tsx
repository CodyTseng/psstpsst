import { Reply as CornerUpLeft } from '@solar-icons/react-native/category/arrows-action/Linear/Reply';
import type { ComponentProps, ComponentType } from 'react';
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { InteractivePressable as Pressable } from '@/components/common/InteractivePressable';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Reanimated, {
  Easing,
  Extrapolation,
  ReduceMotion,
  interpolate,
  interpolateColor,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withSpring,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';

import { SelectionDot } from '@/components/common/SelectionDot';
import { useDirectionalIconStyle, useIsRTL } from '@/i18n/direction';
import { BACK_SWIPE_GUARD } from '@/lib/gestures';
import { impact } from '@/lib/haptics';
import {
  desktopContextMenuPoint,
  IS_ELECTRON,
  type DesktopContextMenuEvent,
  type DesktopPointerPoint,
} from '@/lib/platform';
import type { ReactionAggregate } from '@/lib/nostr/reactions';
import type { FileAttachmentMeta } from '@/lib/nostr/file-tags';
import type { PreparedMessagePresentation } from '@/lib/chat/message-presentation';
import type { MessageDelivery } from '@/stores/delivery-status.store';
import { useThemeColors } from '@/theme';

import { BubbleBody, type RemoteContentMode } from './BubbleBody';
import { ATTACHMENT_FAILURE_TARGET_SIZE } from './attachment-layout';
import {
  BUBBLE_GAP,
  BUBBLE_GROUP_GAP,
  BUBBLE_MAX_WIDTH,
  BUBBLE_ROW_PADDING_HORIZONTAL,
  BUBBLE_SELECTION_OFFSET,
} from './bubble-layout';
import { ReactionsRow } from './ReactionsRow';
import {
  constrainSwipeReplyOffset,
  SWIPE_REPLY_ACTIVATION,
  SWIPE_REPLY_ARMED_FROM,
  SWIPE_REPLY_TRIGGER,
  swipeReplyDistance,
  swipeReplyEdgeInset,
} from './swipe-reply';

const MESSAGE_HIGHLIGHT_HOLD_MS = 500;
const MESSAGE_HIGHLIGHT_FADE_MS = 1700;
export const MESSAGE_HIGHLIGHT_CLEAR_MS =
  MESSAGE_HIGHLIGHT_HOLD_MS + MESSAGE_HIGHLIGHT_FADE_MS + 100;
export const MESSAGE_HIGHLIGHT_REDUCED_CLEAR_MS = 1500;
const MESSAGE_HIGHLIGHT_EASE_OUT = Easing.bezier(0.23, 1, 0.32, 1);

export type MessageBubbleReplyPreview = {
  senderPubkey: string;
  senderDisplayName: string | null;
  contentPreview: string;
};

/** The message visual cluster's on-screen rectangle (window coords), measured
 * when its action menu opens. The optional body sub-rect lets a clipped lifted
 * copy distinguish a cut bubble from a cut reactions row. */
export type BubbleRect = {
  x: number;
  y: number;
  width: number;
  height: number;
  body?: {
    offsetX: number;
    offsetY: number;
    width: number;
    height: number;
  };
  /** Electron context-menu point in viewport coordinates. Touch holds omit it. */
  pointer?: DesktopPointerPoint;
};

type Props = {
  content: string;
  tags?: string[][] | null;
  isSelf: boolean;
  createdAt: number;
  orderAt: number;
  /** Rumor id — used to look up live delivery status (self bubbles only). */
  rumorId?: string;
  /** Persisted delivery (DB) — fallback when there's no live entry. */
  persistedDelivery?: MessageDelivery | null;
  replyTo?: MessageBubbleReplyPreview | null;
  reactions: ReactionAggregate[];
  attachment?: FileAttachmentMeta | null;
  presentation?: PreparedMessagePresentation;
  /** False during the native push: paint the exact bubble without installing
   * swipe/long-press recognizers or their hidden reply affordance yet. */
  interactive?: boolean;
  /** This message's conversation key — threaded to an image attachment so a tap
   * opens the conversation media pager. Constant per list, so it's intentionally
   * left out of the memo comparator below. */
  conversationKey?: string;
  proximity?: boolean;
  /** Remote download policy for accepted, unresolved, or request content. */
  remoteContentMode?: RemoteContentMode;
  /** Optional row background behind/around the bubble. Chat rows stay transparent
   * so the conversation canvas shows through; previews may supply their own colour.
   * Constant per list, so it is left out of the memo comparator. */
  rowBackground?: string;
  onSwipeReply?: () => void;
  /** Fired with the bubble's measured screen rect, to anchor the action menu. */
  onLongPress?: (rect: BubbleRect) => void;
  onShowDelivery?: () => void;
  /** Tap the quoted reply preview → scroll to the referenced message. */
  onPressReply?: () => void;
  /** Briefly flash the row (e.g. after jumping to it from a reply). */
  highlighted?: boolean;
  /** Bumped on every flash request so re-tapping the same reply (while already
   * highlighted) re-triggers the animation — a plain boolean wouldn't change. */
  highlightTick?: number;
  /** True when this bubble starts a new sender run (the older neighbour is from a
   * different sender) — it gets a larger top gap so self/other groups separate;
   * consecutive same-sender bubbles stay tight. */
  groupStart?: boolean;
  /** A separator directly above this bubble owns the boundary spacing, so the
   * normal sender-group gap must not be added again. */
  separatorAbove?: boolean;
  onTapReaction: (reaction: ReactionAggregate) => void;
  /** Selection mode (Telegram-style multi-select, for forwarding): a tap toggles
   * this message; the selected row is tinted. Long-press/swipe are disabled by
   * the parent (their callbacks come through undefined) while selecting. */
  selectionMode?: boolean;
  /** One list-owned animation shared by all received rows. */
  selectionShiftStyle?: ComponentProps<typeof Reanimated.View>['style'];
  selected?: boolean;
  onToggleSelect?: () => void;
};

type DesktopViewProps = ComponentProps<typeof View> & {
  onContextMenu?: (event: DesktopContextMenuEvent) => void;
};

const DesktopView = View as ComponentType<DesktopViewProps>;

function MessageBubbleBase({
  content,
  tags,
  isSelf,
  createdAt,
  orderAt,
  rumorId,
  persistedDelivery,
  replyTo,
  reactions,
  attachment,
  presentation,
  interactive = true,
  conversationKey,
  proximity,
  remoteContentMode,
  rowBackground,
  onSwipeReply,
  onLongPress,
  onShowDelivery,
  onPressReply,
  highlighted,
  highlightTick,
  groupStart,
  separatorAbove,
  onTapReaction,
  selectionMode,
  selectionShiftStyle,
  selected,
  onToggleSelect,
}: Props) {
  const c = useThemeColors();
  const isRTL = useIsRTL();

  // Measure the complete visual cluster (bubble + reactions) and the bubble body
  // within it. Touch lifts that complete cluster; Electron retains the cluster
  // only as its source hover target and anchors the menu to the pointer.
  const messageVisualRef = useRef<View>(null);
  const bubbleRef = useRef<View>(null);
  const emitLongPress = useCallback((withImpact: boolean, pointer?: DesktopPointerPoint) => {
    const visualNode = messageVisualRef.current;
    const bodyNode = bubbleRef.current;
    if (!visualNode || !onLongPress) return;
    if (withImpact) impact('medium');
    visualNode.measureInWindow((x, y, width, height) => {
      if (!bodyNode) {
        onLongPress({ x, y, width, height, pointer });
        return;
      }
      bodyNode.measureInWindow((bodyX, bodyY, bodyWidth, bodyHeight) =>
        onLongPress({
          x,
          y,
          width,
          height,
          body: {
            offsetX: bodyX - x,
            offsetY: bodyY - y,
            width: bodyWidth,
            height: bodyHeight,
          },
          pointer,
        }),
      );
    });
  }, [onLongPress]);

  function handleContextMenu(event: DesktopContextMenuEvent) {
    event.preventDefault?.();
    event.stopPropagation?.();
    emitLongPress(false, desktopContextMenuPoint(event));
  }

  // Signal-style touch swipe-to-reply: drag the bubble in either direction and a
  // round reply arrow fades in beneath the edge the bubble exposes. Past the
  // trigger distance, releasing commits the reply and the bubble springs back.
  const tx = useSharedValue(0);
  const [swipeDecorationsMounted, setSwipeDecorationsMounted] = useState(false);
  const gesture = useMemo(() => {
    if (!interactive) return Gesture.Tap().enabled(false);
    const swipe = Gesture.Pan()
      // Electron reserves mouse dragging for native text selection. Reply remains
      // available from the right-click action menu there.
      .enabled(!IS_ELECTRON && !!onSwipeReply)
      // Keep a left-edge strip free for the OS back-swipe (`UIScreenEdgePan`): the
      // bubble's rightward reply drag would otherwise fight the navigator's pop
      // gesture there. Negative `hitSlop` shrinks the active area off the edge.
      .hitSlop(
        isRTL ? { right: -BACK_SWIPE_GUARD } : { left: -BACK_SWIPE_GUARD },
      )
      .activeOffsetX([-SWIPE_REPLY_ACTIVATION, SWIPE_REPLY_ACTIVATION])
      .failOffsetY([-14, 14]) // … and yield to the list's vertical scroll
      .onStart(() => {
        scheduleOnRN(setSwipeDecorationsMounted, true);
      })
      .onUpdate((e) => {
        const logicalX = e.translationX * (isRTL ? -1 : 1);
        const previousDistance = swipeReplyDistance(tx.get());
        const nextOffset = constrainSwipeReplyOffset(logicalX);
        tx.set(nextOffset);
        const distance = swipeReplyDistance(nextOffset);
        // Tick the instant the drag arms (crosses the trigger), like iOS Messages;
        // re-arm when it falls back below so a re-cross ticks again.
        if (distance >= SWIPE_REPLY_TRIGGER && previousDistance < SWIPE_REPLY_TRIGGER) {
          scheduleOnRN(impact, 'light');
        }
      })
      .onEnd((e) => {
        if (
          swipeReplyDistance(tx.get()) >= SWIPE_REPLY_TRIGGER &&
          onSwipeReply
        ) {
          scheduleOnRN(onSwipeReply);
        }
        tx.set(
          withSpring(0, {
            duration: 400,
            dampingRatio: 0.8,
            velocity: e.velocityX * (isRTL ? -1 : 1),
            overshootClamping: true,
            reduceMotion: ReduceMotion.System,
          }, (finished) => {
            if (finished) scheduleOnRN(setSwipeDecorationsMounted, false);
          }),
        );
      })
      .onFinalize((_event, success) => {
        if (!success) {
          tx.set(0);
          scheduleOnRN(setSwipeDecorationsMounted, false);
        }
      });

    // Touch long-press opens the action menu. It lives in the same RNGH system
    // as the swipe; Electron uses the wrapper's contextmenu handler exclusively.
    const longPress = Gesture.LongPress()
      .enabled(!IS_ELECTRON && !!onLongPress)
      .minDuration(300)
      // The callback runs on recognition, never during render.
      // eslint-disable-next-line react-hooks/refs
      .onStart(() => {
        scheduleOnRN(emitLongPress, true);
      });
    return Gesture.Simultaneous(swipe, longPress);
  }, [interactive, isRTL, onSwipeReply, onLongPress, emitLongPress, tx]);

  const bubbleSlide = useAnimatedStyle(() => ({
    transform: [{ translateX: tx.get() * (isRTL ? -1 : 1) }],
  }));

  return (
    <GestureDetector gesture={gesture}>
      <DesktopView
        onContextMenu={IS_ELECTRON ? handleContextMenu : undefined}
        style={{
          paddingHorizontal: BUBBLE_ROW_PADDING_HORIZONTAL,
          marginTop: separatorAbove
            ? 0
            : groupStart
              ? BUBBLE_GROUP_GAP
              : BUBBLE_GAP,
          backgroundColor: rowBackground ?? 'transparent',
        }}
      >
        <Reanimated.View
          ref={messageVisualRef}
          collapsable={false}
          style={[
            {
              alignSelf: isSelf ? 'flex-end' : 'flex-start',
              // Attachment bodies own their width and reserve an inward side
              // action. Keep that action inside native hit-test bounds even
              // when the conversation is too narrow for the text width cap.
              maxWidth: attachment ? '100%' : BUBBLE_MAX_WIDTH,
              minWidth: 0,
            },
            !isSelf ? selectionShiftStyle ?? {
              transform: [{ translateX: selectionMode ? BUBBLE_SELECTION_OFFSET * (isRTL ? -1 : 1) : 0 }],
            } : undefined,
          ]}
        >
          {/* The bubble + its swipe-reply chip, sized to the bubble. Kept
              separate from the reactions row below so the reply chip's
              top/bottom:0 centring tracks the bubble, not the reactions. */}
          <View
            style={{
              alignSelf: isSelf ? 'flex-end' : 'flex-start',
              maxWidth: '100%',
              minWidth: 0,
            }}
          >
            {/* A reply arrow sits beneath each logical edge. Only the edge exposed
                by the current drag fades in; neither intercepts bubble taps. */}
            {swipeDecorationsMounted ? (
              <SwipeReplyDecorations tx={tx} isSelf={isSelf} hasAttachment={!!attachment} />
            ) : null}

            <Reanimated.View style={bubbleSlide}>
              <View ref={bubbleRef} collapsable={false}>
                <BubbleBody
                  content={content}
                  tags={tags}
                  isSelf={isSelf}
                  createdAt={createdAt}
                  orderAt={orderAt}
                  rumorId={rumorId}
                  persistedDelivery={persistedDelivery}
                  replyTo={replyTo}
                  attachment={attachment}
                  conversationKey={conversationKey}
                  proximity={proximity}
                  remoteContentMode={remoteContentMode}
                  presentation={presentation}
                  onPressReply={onPressReply}
                  onShowDelivery={onShowDelivery}
                />
              </View>
            </Reanimated.View>
          </View>

          {/* Reactions share the bubble's logical edge in a separate row. */}
          <ReactionsRow
            reactions={reactions}
            isSelfBubble={isSelf}
            loadRemote={remoteContentMode === 'auto'}
            onTapReaction={onTapReaction}
          />
        </Reanimated.View>

        {/* Checkbox column — absolutely positioned at the row's start so it never
            eats into the bubble's width; the peer bubble slides right
            (the shared selection transform above) to clear it. */}
        {selectionMode ? (
          <View
            style={{
              position: 'absolute',
              start: 16,
              top: 0,
              bottom: 0,
              justifyContent: 'center',
              pointerEvents: 'none',
            }}
          >
            <SelectionDot selected={!!selected} />
          </View>
        ) : null}

        {/* Selected (forwarding): a steady foreground wash across the whole row —
            the same colour family as the jump-to flash below, just persistent and
            fainter — rather than an accent fill. */}
        {selected ? (
          <View
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              backgroundColor: c.text,
              opacity: 0.1,
              pointerEvents: 'none',
            }}
          />
        ) : null}

        {/* Jump-to flash: a foreground wash across the **whole row**, painted on
            top of everything (the bubble included — not hidden behind it), so even
            an accent self-bubble or an image clearly pulses. Fades out. */}
        {highlighted ? <MessageHighlight key={highlightTick} /> : null}

        {/* Selection mode: a full-row tap target on top of everything (even an
            image/file/link with its own press handler) — a tap toggles this
            message instead of triggering the content's action. */}
        {selectionMode ? (
          <Pressable
            style={StyleSheet.absoluteFill}
            onPress={() => onToggleSelect?.()}
          />
        ) : null}
      </DesktopView>
    </GestureDetector>
  );
}

/** Allocate highlight animation resources only for the highlighted row. */
function MessageHighlight() {
  const c = useThemeColors();
  // Flash overlay when this row is jumped to (e.g. from a reply preview). A
  // foreground-colour wash (not the accent) at a low peak opacity, fading out.
  // Keyed on `highlightTick` too, so re-tapping the same reply re-fires it.
  const highlight = useSharedValue(0);
  const reducedMotion = useReducedMotion();
  const highlightStyle = useAnimatedStyle(() => ({ opacity: highlight.get() }));
  useEffect(() => {
    highlight.set(0.2);
    // Reduced motion keeps the state indication static until `highlighted`
    // clears; collapsing both the delay and fade would make it invisible.
    if (reducedMotion) return;
    highlight.set(
      withDelay(
        MESSAGE_HIGHLIGHT_HOLD_MS,
        withTiming(0, {
          duration: MESSAGE_HIGHLIGHT_FADE_MS,
          easing: MESSAGE_HIGHLIGHT_EASE_OUT,
          reduceMotion: ReduceMotion.Never,
        }),
        ReduceMotion.Never,
      ),
    );
  }, [highlight, reducedMotion]);

  return (
    <Reanimated.View
      style={[
        {
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          backgroundColor: c.text,
          pointerEvents: 'none',
        },
        highlightStyle,
      ]}
    />
  );
}

/** Hidden reply SVGs and their mappers are only needed during an actual swipe.
 * Keeping them out of buffered rows avoids hundreds of idle native resources. */
function SwipeReplyDecorations({ tx, isSelf, hasAttachment }: {
  tx: SharedValue<number>;
  isSelf: boolean;
  hasAttachment: boolean;
}) {
  const c = useThemeColors();
  const directionalIconStyle = useDirectionalIconStyle();
  const replyRevealStart = useAnimatedStyle(() => ({
    opacity: interpolate(
      tx.get(),
      [SWIPE_REPLY_ACTIVATION, SWIPE_REPLY_ARMED_FROM],
      [0, 1],
      Extrapolation.CLAMP,
    ),
  }));
  const replyRevealEnd = useAnimatedStyle(() => ({
    opacity: interpolate(
      -tx.get(),
      [SWIPE_REPLY_ACTIVATION, SWIPE_REPLY_ARMED_FROM],
      [0, 1],
      Extrapolation.CLAMP,
    ),
  }));
  // Muted while below the trigger, accented once the swipe will commit a reply.
  const replyChipFill = useAnimatedStyle(() => ({
    backgroundColor: interpolateColor(
      swipeReplyDistance(tx.get()),
      [SWIPE_REPLY_ARMED_FROM, SWIPE_REPLY_TRIGGER],
      [c.surfaceMuted, c.accentSoft],
    ),
  }));
  const replyArmedArrow = useAnimatedStyle(() => ({
    opacity: interpolate(
      swipeReplyDistance(tx.get()),
      [SWIPE_REPLY_ARMED_FROM, SWIPE_REPLY_TRIGGER],
      [0, 1],
      Extrapolation.CLAMP,
    ),
  }));

  return (
    <>
      {(['start', 'end'] as const).map((edge) => (
            <View
              key={edge}
              style={[
                {
                  position: 'absolute',
                  top: 0,
                  bottom: 0,
                  justifyContent: 'center',
                  pointerEvents: 'none',
                },
                edge === 'start'
                  ? {
                      start: swipeReplyEdgeInset(
                        hasAttachment,
                        isSelf,
                        edge,
                        ATTACHMENT_FAILURE_TARGET_SIZE,
                      ),
                    }
                  : {
                      end: swipeReplyEdgeInset(
                        hasAttachment,
                        isSelf,
                        edge,
                        ATTACHMENT_FAILURE_TARGET_SIZE,
                      ),
                    },
              ]}
            >
              <Reanimated.View
                style={[
                  {
                    width: 28,
                    height: 28,
                    borderRadius: 14,
                    alignItems: 'center',
                    justifyContent: 'center',
                  },
                  edge === 'start'
                    ? replyRevealStart
                    : replyRevealEnd,
                  replyChipFill,
                ]}
              >
                {/* The accent arrow crossfades over the muted arrow once the
                    drag will commit the reply. */}
                <CornerUpLeft
                  size={15}
                  color={c.textMuted}
                  style={directionalIconStyle}
                />
                <Reanimated.View
                  style={[
                    {
                      position: 'absolute',
                      top: 0,
                      left: 0,
                      right: 0,
                      bottom: 0,
                      alignItems: 'center',
                      justifyContent: 'center',
                    },
                    replyArmedArrow,
                  ]}
                >
                  <CornerUpLeft
                    size={15}
                    color={c.accent}
                    style={directionalIconStyle}
                  />
                </Reanimated.View>
              </Reanimated.View>
            </View>
          ))}

    </>
  );
}

/**
 * Compare only the data that affects what a bubble renders. The callback props
 * (onSwipeReply, onLongPress, …) are fresh closures on every parent render but
 * never change the output, so we ignore them — otherwise adding one message
 * would re-render every visible bubble (heavy: the swipe gesture + reply
 * preview), which is what made a freshly-sent bubble appear sluggishly. Live
 * delivery still updates: that comes from a zustand subscription *inside* the
 * bubble, not from props, so memoization doesn't block it.
 */
function areEqual(a: Props, b: Props): boolean {
  if (
    a.content !== b.content ||
    !tagsEqual(a.tags, b.tags) ||
    a.isSelf !== b.isSelf ||
    a.createdAt !== b.createdAt ||
    a.orderAt !== b.orderAt ||
    a.interactive !== b.interactive ||
    a.remoteContentMode !== b.remoteContentMode ||
    a.rumorId !== b.rumorId ||
    a.highlighted !== b.highlighted ||
    a.highlightTick !== b.highlightTick ||
    a.groupStart !== b.groupStart ||
    a.separatorAbove !== b.separatorAbove ||
    a.selectionMode !== b.selectionMode ||
    a.selectionShiftStyle !== b.selectionShiftStyle ||
    a.selected !== b.selected
  ) {
    return false;
  }

  const at1 = a.attachment;
  const at2 = b.attachment;
  if (!!at1 !== !!at2) return false;
  if (
    at1 &&
    at2 &&
    (at1.url !== at2.url || at1.mime !== at2.mime || at1.name !== at2.name)
  ) {
    return false;
  }

  const r1 = a.replyTo;
  const r2 = b.replyTo;
  if (!!r1 !== !!r2) return false;
  if (
    r1 &&
    r2 &&
    (r1.senderPubkey !== r2.senderPubkey ||
      r1.senderDisplayName !== r2.senderDisplayName ||
      r1.contentPreview !== r2.contentPreview)
  ) {
    return false;
  }

  const d1 = a.persistedDelivery;
  const d2 = b.persistedDelivery;
  if (!!d1 !== !!d2) return false;
  if (d1 && d2) {
    const n1 = d1.copies.reduce((n, c) => n + c.relays.length, 0);
    const n2 = d2.copies.reduce((n, c) => n + c.relays.length, 0);
    if (d1.phase !== d2.phase || n1 !== n2) return false;
  }

  if (a.reactions.length !== b.reactions.length) return false;
  for (let i = 0; i < a.reactions.length; i++) {
    const x = a.reactions[i];
    const y = b.reactions[i];
    if (
      x.emoji !== y.emoji ||
      x.customEmoji?.url !== y.customEmoji?.url ||
      x.count !== y.count ||
      x.selfReacted !== y.selfReacted
    ) {
      return false;
    }
  }

  return true;
}

function tagsEqual(
  a: string[][] | null | undefined,
  b: string[][] | null | undefined,
): boolean {
  if (a === b) return true;
  if (!a || !b || a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const x = a[i];
    const y = b[i];
    if (x.length !== y.length) return false;
    for (let j = 0; j < x.length; j++) {
      if (x[j] !== y[j]) return false;
    }
  }
  return true;
}

export const MessageBubble = memo(MessageBubbleBase, areEqual);
