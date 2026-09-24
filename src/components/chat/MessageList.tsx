import ChevronDown from 'lucide-react-native/icons/chevron-down';
import ChevronUp from 'lucide-react-native/icons/chevron-up';
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useTranslation } from 'react-i18next';
import { useIsRTL } from '@/i18n/direction';
import { BUBBLE_SELECTION_OFFSET } from './bubble-layout';
import {
  ActivityIndicator,
  FlatList,
  View,
  type ListRenderItemInfo,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  type ViewToken,
} from 'react-native';
import Animated, {
  Easing,
  runOnJS,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';

import { iconStrokeWidth } from '@/theme/icons';
import { radius, shadow, spacing, useThemeColors } from '@/theme';

import type { messages as messagesSchema } from '@/db/schema';
import { AppText } from '@/components/common/AppText';
import { CountBadge } from '@/components/common/CountBadge';
import { FrostedBackdrop } from '@/components/common/FrostedBackdrop';
import { IconButton } from '@/components/common/IconButton';
import { useContactsMap } from '@/hooks/use-contacts';
import { MESSAGES_PAGE_SIZE, type MessageBoundary } from '@/hooks/use-messages';
import { useElectronHistoryPagination } from '@/hooks/use-electron-history-pagination';
import { markChatMessageListMounted } from '@/lib/perf/chat-open';
import { useProfilesMap } from '@/hooks/use-profile';
import {
  isNearMessageHistoryEdge,
  isNearMessageTail,
  messageHistoryPageRequest,
  MESSAGE_HISTORY_PREFETCH_VIEWPORTS,
  messageTailScrollMode,
  shouldMaintainVisibleMessagePosition,
  type MessageTailScrollMode,
} from '@/lib/chat/message-tail-follow';
import type { ReactionAggregate } from '@/lib/nostr/reactions';
import { attachmentLabel } from '@/lib/nostr/attachment-label';
import { resolveDisplayName } from '@/lib/nostr/display-name';
import { prepareMessagePresentation } from '@/lib/chat/message-presentation';
import { formatDateSeparator, isDifferentDay } from '@/lib/time';
import type { MessageDelivery } from '@/stores/delivery-status.store';
import type { PendingAttachment } from '@/stores/pending-attachments.store';
import type { PreparedBubbleRenderItem } from '@/services/conversation/message-tail-cache';

import type { RemoteContentMode } from './BubbleBody';
import type { LiftedBubble } from './MessageActionMenu';
import {
  MESSAGE_HIGHLIGHT_CLEAR_MS,
  MESSAGE_HIGHLIGHT_REDUCED_CLEAR_MS,
  MessageBubble,
  type BubbleRect,
  type MessageBubbleReplyPreview,
} from './MessageBubble';
import { DatePill, DateSeparator } from './message-date-separator';
import { PendingAttachmentBubble } from './PendingAttachmentBubble';
import {
  startsLoadedTimelineDay,
  startsLoadedSenderGroup,
  startsTimelineDay,
  timelineItemCreatedAt,
} from './message-timeline-boundary';

type MessageRow = typeof messagesSchema.$inferSelect;

function isMessageFromSelf(
  message: MessageRow,
  fallbackPubkey: string,
  proximity: boolean,
): boolean {
  return proximity
    ? message.senderPubkey !== message.conversationKey
    : message.senderPubkey === fallbackPubkey;
}

/** Full-width "Unread messages" band marking where the user last left off
 * (Telegram/Signal). Distinct from the content-hugging `DatePill` by spanning
 * the row; deliberately calm (`surfaceMuted`, not an alarm red) like the date
 * capsule family. Rendered once, above the first unread message. */
function UnreadDivider({ label }: { label: string }) {
  const c = useThemeColors();
  return (
    <View
      style={{
        marginVertical: spacing.sm,
        marginHorizontal: spacing.md,
        backgroundColor: c.surfaceMuted,
        borderRadius: radius.sm,
        paddingVertical: spacing.xs,
        alignItems: 'center',
      }}
    >
      <AppText variant="caption" tone="subtle">
        {label}
      </AppText>
    </View>
  );
}

type Props = {
  messages: MessageRow[];
  pendingAttachments: PendingAttachment[];
  /** Incremented only by an attachment send/retry on this mounted chat page. */
  pendingTailVersion: number;
  /** Incremented only by an upload failure on this mounted chat page. */
  pendingFailureVersion: number;
  accountPubkey: string;
  /** Pubkey used to classify own bubbles; defaults to the owning account. */
  selfPubkey?: string;
  proximity?: boolean;
  /** Transport-local peer name used by Nearby quoted replies. */
  peerDisplayName?: string | null;
  conversationKey: string;
  /** Remote download policy for accepted, unresolved, or request content. */
  remoteContentMode: RemoteContentMode;
  reactionsByMessageId: Record<string, ReactionAggregate[]>;
  presentationsByMessageId: Readonly<
    Record<string, ReturnType<typeof prepareMessagePresentation>>
  >;
  bubbleRenderItemsById: Readonly<Record<string, PreparedBubbleRenderItem>>;
  deliveriesByMessageId: Record<string, MessageDelivery>;
  /** Reply targets that fall outside the loaded window (fetched by id). */
  referencedById: Record<string, MessageRow>;
  /** Load an older page (reaching the top of the list). */
  onLoadOlder: () => void;
  /** Load a newer page (anchored mode → reaching the bottom). */
  onLoadNewer: () => void;
  /** Whether older pages may still exist (drives the top spinner). */
  hasMore: boolean;
  /** Whether an older page is currently being read. */
  loadingOlder: boolean;
  /** Whether a historical window is paging toward the live tail. */
  loadingNewer: boolean;
  /** Whether newer pages exist between the window and the live tail. */
  hasMoreNewer: boolean;
  /** Creation time of the unrendered row immediately beyond the oldest edge. */
  oldestBoundary: MessageBoundary | null | undefined;
  tailJumpVersion: number;
  /** True while the window is centred on a jumped-to message (not the tail). */
  anchored: boolean;
  /** Whether the active window's queries have all resolved (both sides, when
   * anchored). A jump-open waits on this so it positions only once the target's
   * row index is final. */
  windowLoaded: boolean;
  /** Re-centre the window on a target message — used to reach a reply target or
   * search hit that's outside the current window without loading everything in
   * between. */
  onFocusAnchor: (anchor: { orderAt: number; id: string }) => void;
  /** Drop the anchor and return to the live newest window. */
  onJumpToTail: () => void;
  /** A message to scroll to + flash once it's in the window (a search jump). */
  focusMessageId?: string;
  /** Frozen read cursor captured when the chat opened: `(order_at, id)`. The
   * first message strictly after it (same key the list sorts by) gets the
   * "unread messages" divider above it. Null → no divider (nothing read, or
   * nothing unread). The id is the final deterministic tie-breaker. */
  unreadBoundaryOrderAt?: number | null;
  unreadBoundaryId?: string | null;
  /** Exact oldest unread message, used as the divider and jump anchor. */
  firstUnreadOrderAt?: number | null;
  firstUnreadId?: string | null;
  /** Frozen unread count: gates the divider and bounds background preloading. */
  unreadCount?: number;
  /** Hide unread and newly-arrived markers while retaining ordinary scrolling. */
  showNewMessageIndicators?: boolean;
  onSwipeReply?: (message: MessageRow) => void;
  /** Long-press a bubble: hands up the message, its measured screen rect, and a
   * ready-to-render lifted copy (reply/attachment already resolved here). */
  onLongPress: (
    message: MessageRow,
    rect: BubbleRect,
    bubble: LiftedBubble,
  ) => void;
  /** Long-press a failed local upload into the shared action menu. */
  onLongPressPending: (
    pending: PendingAttachment,
    rect: BubbleRect,
    bubble: LiftedBubble,
  ) => void;
  onTapReaction: (message: MessageRow, reaction: ReactionAggregate) => void;
  onShowDelivery?: (messageId: string) => void;
  onRetryPending: (tempId: string) => void;
  onStopPending: (tempId: string) => void;
  onCancelPending: (tempId: string) => void;
  /** Selection mode (forwarding): when true, a tap toggles a message instead of
   * long-press/swipe; selected ids are tinted. */
  selectionMode?: boolean;
  selectedIds?: Set<string>;
  onToggleSelect?: (messageId: string) => void;
  /** Clear the composer that overlays the bottom of the list. */
  bottomInset: number;
  /** Clear the title bar that overlays the top of the list. */
  topInset: number;
  /** Attach secondary profile/contact live reads after native navigation while
   * retaining memory-cached names for the first interactive route commit. */
  liveDataEnabled?: boolean;
  /** Keep the mounted gesture tree stable while subscriptions pause on blur. */
  interactive?: boolean;
};

type ListItemSource =
  | {
      kind: 'message';
      message: MessageRow;
      prepared: PreparedBubbleRenderItem | null;
    }
  | { kind: 'pending'; pending: PendingAttachment };

type ListItem = ListItemSource & {
  /** The adjacent older source. Stored on the item so a prepended history page
   * changes only the previous boundary cell, not renderItem. */
  older: ListItemSource | null;
  boundaryCreatedAt: number | null | undefined;
  boundaryIsSelf: boolean | null | undefined;
};

type CachedListItem = {
  prepared: PreparedBubbleRenderItem | null;
  olderSource: MessageRow | PendingAttachment | null;
  boundaryCreatedAt: number | null | undefined;
  boundaryIsSelf: boolean | null | undefined;
  item: ListItem;
};

/** Tapping a reply to an out-of-window target pages older up to this many times,
 * smoothly scrolling to it once it appears. A reply almost always points just up
 * the thread, so this stays small — within it a smooth scroll is short and
 * reliable; past it (a genuinely distant target) we hand off to the focus jump,
 * which is exact regardless of distance. */
const MAX_SEEK_PAGES = 3;

/** Older rows we want loaded *above* a reply target before scrolling to it, so it
 * can sit mid-screen rather than clamping to the very top (where it would only
 * peek out). One `loadOlder` adds a whole page past the target, so reaching this
 * never takes more than a page. Skipped when there's no older left (top of
 * history). */
const SEEK_MARGIN = 8;

/** Keep normal history releases aligned with FlatList's cell batch. Waiting two
 * frames between batches gives input a chance to run without starving flings. */
const MESSAGE_CELL_RENDER_BATCH_PERIOD_MS = 32;

const ANCHORED_VISIBLE_POSITION = { minIndexForVisible: 1 } as const;

export function MessageList({
  messages,
  pendingAttachments,
  pendingTailVersion,
  pendingFailureVersion,
  accountPubkey,
  selfPubkey = accountPubkey,
  proximity = false,
  peerDisplayName,
  conversationKey,
  remoteContentMode,
  reactionsByMessageId,
  presentationsByMessageId,
  bubbleRenderItemsById,
  deliveriesByMessageId,
  referencedById,
  onLoadOlder,
  onLoadNewer,
  hasMore,
  loadingOlder,
  loadingNewer,
  hasMoreNewer,
  oldestBoundary,
  tailJumpVersion,
  anchored,
  windowLoaded,
  onFocusAnchor,
  onJumpToTail,
  focusMessageId,
  unreadBoundaryOrderAt,
  unreadBoundaryId,
  firstUnreadOrderAt,
  firstUnreadId: firstUnreadMessageId,
  unreadCount = 0,
  showNewMessageIndicators = true,
  onSwipeReply,
  onLongPress,
  onLongPressPending,
  onTapReaction,
  onShowDelivery,
  onRetryPending,
  onStopPending,
  onCancelPending,
  selectionMode,
  selectedIds,
  onToggleSelect,
  bottomInset,
  topInset,
  liveDataEnabled = true,
  interactive = true,
}: Props) {
  const { t } = useTranslation();
  const c = useThemeColors();
  const reducedMotion = useReducedMotion();
  const isRTL = useIsRTL();
  // All received messages move together; one mapper owns this transition
  // instead of installing a dormant selection mapper in every buffered row.
  const selectionShiftStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: withTiming(
      selectionMode ? BUBBLE_SELECTION_OFFSET * (isRTL ? -1 : 1) : 0,
      { duration: reducedMotion ? 0 : 200 },
    ) }],
  }));
  const boundaryIsSelf = oldestBoundary == null
    ? oldestBoundary
    : proximity
      ? oldestBoundary.senderPubkey !== conversationKey
      : oldestBoundary.senderPubkey === selfPubkey;
  const listRef = useRef<FlatList<ListItem>>(null);
  const scrollMetricsRef = useRef({
    offsetY: 0,
    viewportHeight: 0,
    contentHeight: 0,
  });
  // Warm one page before the first interaction. Once the reader starts moving
  // toward history, keep paging by distance for the rest of the session instead
  // of requiring a fresh gesture for every page.
  const initialHistoryPrefetchRef = useRef(true);
  const continuousHistoryPagingRef = useRef(false);
  // Native content updates must not start a tail correction while the reader's
  // drag or momentum scroll is still in progress.
  const userScrollInProgressRef = useRef(false);
  // Whether the list is currently pinned at the bottom. A ref so
  // pending-row layout corrections can read it without re-subscribing on every
  // scroll.
  const atBottomRef = useRef(true);
  useLayoutEffect(() => {
    markChatMessageListMounted(conversationKey);
    initialHistoryPrefetchRef.current = true;
    continuousHistoryPagingRef.current = false;
  }, [conversationKey]);
  const attachmentLabels = useMemo(
    () => ({
      file: t('conversations.attachment_file_preview'),
      image: t('conversations.attachment_image_preview'),
      video: t('conversations.attachment_video_preview'),
      voice: t('conversations.attachment_voice_preview'),
    }),
    [t],
  );
  // A reply target that's out of the window and too far to scroll to: route it
  // through the **same proven jump** as a search / gallery open by setting a
  // *local* focus id (merged with the `focusMessageId` prop into `activeFocusId`
  // below), so it gets the full treatment — wait for the re-anchored window, render
  // it whole so rows are measured, snap to centre under the cover. Cleared on a
  // return to the live tail.
  const [localFocusId, setLocalFocusId] = useState<string | null>(null);
  // Reply target we're paging *older* toward (the near path: a reply usually
  // points just up the thread, so we grow the window a few pages until it appears
  // and scroll to it — no jarring re-anchor). Cleared once found or given up on.
  const [seekReplyId, setSeekReplyId] = useState<string | null>(null);
  const seekAttemptsRef = useRef(0);
  // The jump target driving the focus machinery — the `focusMessageId` prop (a
  // search / gallery open) or a locally-set far reply, whichever is active.
  const activeFocusId = focusMessageId ?? localFocusId;
  const tailMode = activeFocusId == null && !anchored;
  // A small unread tail already fits in the first page, so marking its boundary
  // adds visual noise and can perturb the list after first paint. Only
  // keep the divider affordance when the unread tail fills at least one page.
  const showUnreadDivider = showNewMessageIndicators && unreadCount >= MESSAGES_PAGE_SIZE;
  const pendingIdsSignature = pendingAttachments
    .map((pending) => pending.tempId)
    .join('|');
  // Existing pending items can join one frame after the DB rows (route/store
  // subscription timing). MVCP can then anchor a DB row instead of the
  // tail. Hide only that first pending layout, snap to offset 0 without
  // animation once its content size is known, then reveal. A send on this page
  // carries a new `pendingTailVersion` and follows the normal animated path.
  const [pendingInitialPosition, setPendingInitialPosition] = useState(() => ({
    idsSignature: pendingIdsSignature,
    tailVersion: pendingTailVersion,
    tailMode,
    ready: !tailMode || pendingAttachments.length === 0,
  }));
  if (
    pendingInitialPosition.idsSignature !== pendingIdsSignature ||
    pendingInitialPosition.tailVersion !== pendingTailVersion ||
    pendingInitialPosition.tailMode !== tailMode
  ) {
    const previousIds = new Set(
      pendingInitialPosition.idsSignature.length > 0
        ? pendingInitialPosition.idsSignature.split('|')
        : [],
    );
    const hasAddedPending = pendingAttachments.some(
      (pending) => !previousIds.has(pending.tempId),
    );
    const explicitTailRequest =
      pendingInitialPosition.tailVersion !== pendingTailVersion;
    setPendingInitialPosition({
      idsSignature: pendingIdsSignature,
      tailVersion: pendingTailVersion,
      tailMode,
      ready: !tailMode || !hasAddedPending || explicitTailRequest,
    });
  }
  const pendingInitialPositionRafRef = useRef<number | null>(null);
  const pendingRemovalPinRafRef = useRef<number | null>(null);
  const pinTailAfterPendingRemovalRef = useRef(false);

  function handleContentSizeChange(_width: number, contentHeight: number) {
    scrollMetricsRef.current.contentHeight = contentHeight;
    if (!pendingInitialPosition.ready && tailMode) {
      if (userScrollInProgressRef.current || !atBottomRef.current) {
        setPendingInitialPosition((current) =>
          current.ready ? current : { ...current, ready: true },
        );
      } else {
        listRef.current?.scrollToOffset({ offset: 0, animated: false });
        if (pendingInitialPositionRafRef.current != null) {
          cancelAnimationFrame(pendingInitialPositionRafRef.current);
        }
        pendingInitialPositionRafRef.current = requestAnimationFrame(() => {
          if (!userScrollInProgressRef.current && atBottomRef.current) {
            listRef.current?.scrollToOffset({ offset: 0, animated: false });
          }
          pendingInitialPositionRafRef.current = null;
          setPendingInitialPosition((current) =>
            current.ready ? current : { ...current, ready: true },
          );
        });
      }
    }

    // The released row is now in the native list. Issue the tail correction
    // exactly once from this committed content-size event; a timer-based second
    // animated scroll restarts iOS momentum and visibly stalls halfway through.
    if (
      pendingInitialPosition.ready &&
      pendingTailScrollAfterReleaseRef.current != null &&
      !anchored &&
      stagedCount === 0
    ) {
      const scrollMode = pendingTailScrollAfterReleaseRef.current;
      pendingTailScrollAfterReleaseRef.current = null;
      if (!userScrollInProgressRef.current) {
        listRef.current?.scrollToOffset({
          offset: 0,
          animated: scrollMode === 'animated',
        });
      }
    }

    // Removing the final pending row can make MVCP preserve the adjacent bubble
    // by converting the removed cell's height into scroll offset. When
    // the user discarded from the tail, reset that compensation only after the
    // new content size is committed, so no empty cell-height gap remains.
    if (pinTailAfterPendingRemovalRef.current) {
      if (userScrollInProgressRef.current || !atBottomRef.current) {
        pinTailAfterPendingRemovalRef.current = false;
      } else {
        listRef.current?.scrollToOffset({ offset: 0, animated: false });
        if (pendingRemovalPinRafRef.current != null) {
          cancelAnimationFrame(pendingRemovalPinRafRef.current);
        }
        pendingRemovalPinRafRef.current = requestAnimationFrame(() => {
          if (!userScrollInProgressRef.current && atBottomRef.current) {
            listRef.current?.scrollToOffset({ offset: 0, animated: false });
          }
          pendingRemovalPinRafRef.current = null;
          pinTailAfterPendingRemovalRef.current = false;
        });
      }
    }

    const { viewportHeight } = scrollMetricsRef.current;
    if (viewportHeight > 0 && contentHeight <= viewportHeight) {
      requestOlderFromScroll(true);
    }
  }

  useEffect(
    () => () => {
      if (pendingInitialPositionRafRef.current != null) {
        cancelAnimationFrame(pendingInitialPositionRafRef.current);
      }
      if (pendingRemovalPinRafRef.current != null) {
        cancelAnimationFrame(pendingRemovalPinRafRef.current);
      }
    },
    [],
  );
  // Briefly highlight a row after jumping to it. The `tick` bumps on every flash
  // so re-tapping the same reply re-fires the animation (a bare id wouldn't change).
  const [flashTarget, setFlashTarget] = useState<{
    id: string;
    tick: number;
  } | null>(null);
  const flashTickRef = useRef(0);
  const highlightTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Show a "scroll to bottom" button once scrolled up far enough.
  const [showScrollDown, setShowScrollDown] = useState(false);
  const showScrollDownRef = useRef(false);
  // Inverted lists open pinned to the bottom on the very first frame, so a
  // normal open needs no cover. The one exception is opening straight into a
  // search jump (`focusMessageId`): the anchored window first lays out at its
  // newest end, then we scrollToIndex to the target — cover only that single
  // reposition so it isn't seen as a flash.
  const [ready, setReady] = useState(() => !focusMessageId);
  // Where the unread divider lies relative to the viewport: 'above' (higher up
  // / older-ward), 'below' (toward the newest), or null when it's on screen or
  // absent. Drives the jump-to-unread button.
  const [unreadDir, setUnreadDir] = useState<'above' | 'below' | null>(null);
  // Floating sticky date header: the date of the topmost visible message,
  // shown while scrolling and faded out once the list settles / hits bottom.
  // It animates with a directional crossfade — the outgoing capsule slides up
  // and out, then the new one rises from below — to echo the inline separator
  // being pushed up from below (Telegram-style), instead of snapping the text.
  const [floatingDate, setFloatingDate] = useState<string | null>(null);
  const floatingOpacity = useSharedValue(0);
  const floatingTransY = useSharedValue(0);
  const floatingHideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Two independent suppressors of the floating header: `active` (the user is
  // scrolling and not at the bottom) and `dupe` (the topmost visible message is
  // a day-start, so its own inline separator is already on screen and a floating
  // copy would just duplicate it). It shows only when active && !dupe.
  const floatingActiveRef = useRef(false);
  const floatingDupeRef = useRef(false);
  // The date the header *wants* to show (topmost visible day) vs. the one it is
  // currently rendering, and whether it is presently faded in.
  const floatingTargetRef = useRef<string | null>(null);
  const displayedDateRef = useRef<string | null>(null);
  const floatingVisibleRef = useRef(false);
  // The newest message id that's released into the rendered list. Incoming
  // messages that arrive while the user is reading history (scrolled up) are
  // *not* inserted immediately — that jolts the list and breaks reading — they
  // stay staged just past this boundary and only get revealed when the user
  // returns to the bottom (scroll or button). null = release everything (the
  // common at-bottom case).
  const [releasedNewestId, setReleasedNewestId] = useState<string | null>(null);
  // Whether the reader is close enough to the bottom that new messages should
  // join the visible tail immediately. This matches the scroll-down control's
  // appearance threshold, so an absent control never flashes in for one arrival.
  const nearTailRef = useRef(true);
  // The newest tail message we've already accounted for, so we can tell a real
  // new arrival from an older page being prepended.
  const prevNewestRef = useRef<{ id: string; orderAt: number } | null>(null);
  const pendingTailScrollAfterReleaseRef = useRef<MessageTailScrollMode>(null);

  function handleScrollBeginDrag() {
    userScrollInProgressRef.current = true;
    continuousHistoryPagingRef.current = true;
    // Treat a deliberate gesture as leaving the tail until its final offset is
    // known. This prevents an async row commit from racing the first scroll tick.
    atBottomRef.current = false;
    nearTailRef.current = false;
    if (scrollMetricsRef.current.offsetY >= 24) activateFloatingDate(false);
  }

  function handleMomentumScrollBegin() {
    userScrollInProgressRef.current = true;
    continuousHistoryPagingRef.current = true;
    if (scrollMetricsRef.current.offsetY >= 24) activateFloatingDate(false);
  }

  function requestOlderFromScroll(fillShortViewport = false) {
    const decision = messageHistoryPageRequest({
      ready: ready && windowLoaded,
      hasMore,
      loading: loadingOlder,
      continuous: continuousHistoryPagingRef.current || fillShortViewport,
      initialAvailable: initialHistoryPrefetchRef.current,
    });
    if (!decision.request) return;
    if (decision.consumeInitial) {
      initialHistoryPrefetchRef.current = false;
    }
    onLoadOlder();
  }

  useEffect(() => {
    if (!windowLoaded || activeFocusId != null) return;
    const frame = requestAnimationFrame(() => requestOlderFromScroll());
    return () => cancelAnimationFrame(frame);
    // This is the one post-hydration prefetch. Later pages are driven by the
    // distance callbacks and must not turn a state change into an eager loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [windowLoaded]);

  function handleScrollSettled(
    event: NativeSyntheticEvent<NativeScrollEvent>,
  ) {
    userScrollInProgressRef.current = false;
    const {
      contentOffset,
      contentSize,
      layoutMeasurement,
    } = event.nativeEvent;
    nearTailRef.current = isNearMessageTail(contentOffset.y);
    atBottomRef.current = contentOffset.y < 24;
    scrollMetricsRef.current = {
      offsetY: contentOffset.y,
      viewportHeight: layoutMeasurement.height,
      contentHeight: contentSize.height,
    };
    if (atBottomRef.current) clearFloatingActive();
    else scheduleFloatingDateHide();

    // The edge callback only fires after its final cell has rendered.
    // A fast fling can reach the physical edge before that happens and leave no
    // further scroll event to retry it, so settled gestures perform one guarded
    // edge check. useMessages deduplicates repeated requests for the same page.
    if (
      isNearMessageHistoryEdge({
        offsetY: contentOffset.y,
        contentHeight: contentSize.height,
        viewportHeight: layoutMeasurement.height,
      })
    ) {
      requestOlderFromScroll();
    }
  }

  // Index (into ascending `messages`) of the released boundary. Everything up
  // to and including it is rendered; anything newer is staged (held back).
  // Our own messages are never staged — a freshly-sent bubble must appear in
  // the same render it lands in `messages` (not a frame later when the effect
  // advances the boundary), so we extend the boundary to our last own message.
  const releasedIdx = useMemo(() => {
    let stored = messages.length - 1;
    if (releasedNewestId != null) {
      const i = messages.findIndex((m) => m.id === releasedNewestId);
      if (i !== -1) stored = i;
    }
    let lastSelf = -1;
    for (let i = messages.length - 1; i >= 0; i--) {
      if (isMessageFromSelf(messages[i], selfPubkey, proximity)) {
        lastSelf = i;
        break;
      }
    }
    return Math.max(stored, lastSelf);
  }, [messages, releasedNewestId, selfPubkey, proximity]);
  // While anchored on a jumped-to message we render the whole bounded window and
  // skip staging entirely (staging assumes the window follows the live tail).
  const displayedMessages = useMemo(
    () => (anchored ? messages : messages.slice(0, releasedIdx + 1)),
    [messages, releasedIdx, anchored],
  );
  // How many messages are staged just past the boundary — drives the badge.
  const stagedCount = anchored ? 0 : messages.length - (releasedIdx + 1);

  /** Reveal all staged messages by advancing the boundary to the newest. */
  function releaseStaged() {
    if (messages.length > 0)
      setReleasedNewestId(messages[messages.length - 1].id);
  }

  function flash(id: string) {
    flashTickRef.current += 1;
    setFlashTarget({ id, tick: flashTickRef.current });
    if (highlightTimer.current) clearTimeout(highlightTimer.current);
    highlightTimer.current = setTimeout(
      () => setFlashTarget(null),
      reducedMotion
        ? MESSAGE_HIGHLIGHT_REDUCED_CLEAR_MS
        : MESSAGE_HIGHLIGHT_CLEAR_MS,
    );
  }
  useEffect(
    () => () => {
      if (highlightTimer.current) clearTimeout(highlightTimer.current);
    },
    [],
  );

  // Drives the cover + the "stop waiting" safety net for a jump. Re-armed on every
  // new focus target. The timeout reveals the conversation even if the target
  // cannot be loaded, so focus navigation cannot leave the screen covered.
  const [focusExpired, setFocusExpired] = useState(false);
  const prevActiveFocusRef = useRef<string | null>(activeFocusId);
  useEffect(() => {
    if (activeFocusId == null) {
      prevActiveFocusRef.current = null; // so re-focusing the same id later re-arms
      return;
    }
    if (activeFocusId !== prevActiveFocusRef.current) {
      prevActiveFocusRef.current = activeFocusId;
      setReady(false);
      setFocusExpired(false);
    }
    const t = setTimeout(() => {
      setReady(true);
      setFocusExpired(true);
    }, 1000);
    return () => clearTimeout(t);
  }, [activeFocusId]);

  function scrollToBottom() {
    if (anchored) {
      // From a jumped-to (anchored) window, "jump to latest" just **drops the
      // anchor and reloads the live tail** — a fresh small window, never paging
      // forward through everything in between (which would be endless from a very
      // old message). Don't animate-scroll the stale anchored content here (that's
      // the visible "long scroll"); the anchored→tail effect lands at the newest,
      // without animation, once the tail window is in.
      onJumpToTail();
      return;
    }
    if (stagedCount > 0) {
      pendingTailScrollAfterReleaseRef.current = 'animated';
      releaseStaged();
      return;
    }
    releaseStaged();
    listRef.current?.scrollToOffset({ offset: 0, animated: true });
  }

  // Directional crossfade: the capsule rests at translateY 0; it leaves by
  // sliding up (−SLIDE) and enters by rising from below (+SLIDE), echoing the
  // inline separator that pushes it up.
  const FLOAT_SLIDE = 8;
  function floatIn() {
    floatingTransY.value = FLOAT_SLIDE; // jump below, then rise to rest
    floatingTransY.value = withTiming(0, {
      duration: 180,
      easing: Easing.out(Easing.quad),
    });
    floatingOpacity.value = withTiming(1, {
      duration: 180,
      easing: Easing.out(Easing.quad),
    });
  }
  function floatOut(after?: () => void) {
    floatingTransY.value = withTiming(-FLOAT_SLIDE, {
      duration: 140,
      easing: Easing.in(Easing.quad),
    });
    floatingOpacity.value = withTiming(
      0,
      { duration: 140, easing: Easing.in(Easing.quad) },
      (finished) => {
        if (finished && after) runOnJS(after)();
      },
    );
  }

  /** Push a new label into the header (it fades in via the floatingDate effect). */
  function commitFloatingText(next: string) {
    displayedDateRef.current = next;
    setFloatingDate(next);
  }

  /** Reconcile the header from its suppressors + target date. */
  function reconcileFloating() {
    const visible = floatingActiveRef.current && !floatingDupeRef.current;
    if (!visible) {
      if (floatingVisibleRef.current) {
        floatingVisibleRef.current = false;
        floatOut();
      }
      return;
    }
    const next = floatingTargetRef.current;
    if (next == null) return;
    if (next === displayedDateRef.current) {
      if (!floatingVisibleRef.current) {
        floatingVisibleRef.current = true;
        floatIn();
      }
      return;
    }
    // The label needs to change while staying visible: slide the old one out,
    // then swap the text (the effect fades the new one in). If it's currently
    // hidden, swap straight away.
    if (floatingVisibleRef.current) {
      floatingVisibleRef.current = false;
      floatOut(() => commitFloatingText(next));
    } else {
      commitFloatingText(next);
    }
  }

  // Fade the (new) label in once it has rendered, so the rise never shows the
  // stale text for a frame.
  useEffect(() => {
    if (floatingDate == null) return;
    if (floatingActiveRef.current && !floatingDupeRef.current) {
      floatingVisibleRef.current = true;
      floatIn();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [floatingDate]);

  /** Show the floating date without doing timer work on every scroll event. */
  function activateFloatingDate(autoHide: boolean) {
    if (floatingHideTimer.current) clearTimeout(floatingHideTimer.current);
    floatingHideTimer.current = null;
    if (!floatingActiveRef.current) {
      floatingActiveRef.current = true;
      reconcileFloating();
    }
    if (autoHide) scheduleFloatingDateHide();
  }

  function scheduleFloatingDateHide() {
    if (floatingHideTimer.current) clearTimeout(floatingHideTimer.current);
    floatingHideTimer.current = setTimeout(() => {
      floatingHideTimer.current = null;
      floatingActiveRef.current = false;
      reconcileFloating();
    }, 1400);
  }

  /** Hide the floating header immediately (e.g. the list returned to bottom). */
  function clearFloatingActive() {
    if (!floatingActiveRef.current && floatingHideTimer.current == null) return;
    floatingActiveRef.current = false;
    if (floatingHideTimer.current) {
      clearTimeout(floatingHideTimer.current);
      floatingHideTimer.current = null;
    }
    reconcileFloating();
  }

  useEffect(
    () => () => {
      if (floatingHideTimer.current) clearTimeout(floatingHideTimer.current);
    },
    [],
  );

  const floatingStyle = useAnimatedStyle(() => ({
    opacity: floatingOpacity.value,
    transform: [{ translateY: floatingTransY.value }],
  }));

  // The label tracks the topmost visible message. `data` is newest-first and the
  // list is inverted, so the largest viewable index is the message highest on
  // screen. Fires only on viewability changes
  // (not per scroll frame), so it's cheap regardless of conversation size. The
  // ref callback is stable, so it reads the live list through `dataRef`.
  const handleViewableItemsChanged = useRef(
    ({ viewableItems }: { viewableItems: ViewToken<ListItem>[] }) => {
      // Unread divider direction: compare its row index to the visible range.
      // Inverted (newest-first): an index past the visible maximum is above the
      // viewport (older); below the minimum is toward the newest end (down).
      const fuIdx = firstUnreadIndexRef.current;
      if (fuIdx == null) {
        setUnreadDir((p) => (p === null ? p : null));
      } else {
        let minIdx = Infinity;
        let maxIdx = -Infinity;
        for (const v of viewableItems) {
          if (v.index == null) continue;
          if (v.index < minIdx) minIdx = v.index;
          if (v.index > maxIdx) maxIdx = v.index;
        }
        const dir: 'above' | 'below' | null =
          maxIdx < minIdx
            ? null
            : fuIdx > maxIdx
              ? 'above'
              : fuIdx < minIdx
                ? 'below'
                : null;
        setUnreadDir((p) => (p === dir ? p : dir));
      }

      let topIdx = -Infinity;
      let topMsg: MessageRow | null = null;
      for (const v of viewableItems) {
        if (v.index == null) continue;
        const it = v.item as ListItem;
        if (it.kind !== 'message') continue;
        if (v.index > topIdx) {
          topIdx = v.index;
          topMsg = it.message;
        }
      }
      if (!topMsg) return;
      floatingTargetRef.current = formatDateSeparator(topMsg.createdAt);
      // When the topmost visible message is itself a day-start, its inline
      // separator is on screen — suppress the floating copy so they don't
      // double up. (Same predicate the renderer uses for `showDate`: the older
      // neighbour is `topIdx + 1`.)
      const arr = dataRef.current;
      const older = arr[topIdx + 1];
      floatingDupeRef.current =
        !older ||
        older.kind !== 'message' ||
        isDifferentDay(topMsg.createdAt, older.message.createdAt);
      reconcileFloating();
    },
  ).current;
  const viewabilityConfig = useRef({ itemVisiblePercentThreshold: 1 }).current;

  // React to new tail messages. A new message prepends at index 0 of the
  // inverted list. MVCP holds the reader's position, so we follow the tail
  // explicitly: scroll to offset 0 for our own sends, or for an incoming message
  // when the reader is near the bottom. Use a layout effect so the released
  // boundary commits before paint; a near-tail arrival therefore cannot expose
  // the transient staged count and flash the scroll-down control for one frame.
  // Incoming messages that land while the user is farther up stay staged, so
  // nothing shifts while history is being read. An older page prepends at the
  // top, leaving the newest unchanged, so it never triggers here.
  useLayoutEffect(() => {
    if (messages.length === 0) return;
    const newest = messages[messages.length - 1];
    const prev = prevNewestRef.current;
    prevNewestRef.current = { id: newest.id, orderAt: newest.orderAt };
    // Anchored mode renders the whole window and never stages — growing it via
    // loadNewer must not be mistaken for a tail arrival or trigger an auto-scroll.
    if (anchored) return;
    if (!prev) {
      setReleasedNewestId(newest.id); // first load: show the whole window
      return;
    }
    if (newest.id === prev.id) return;

    const fromSelf = isMessageFromSelf(newest, selfPubkey, proximity);
    if (fromSelf || nearTailRef.current) {
      // MVCP preserves the visible row but no longer owns auto-following. Arm an
      // instant correction at the exact tail, or an animated one within the
      // near-tail band, after the released row joins the native list.
      pendingTailScrollAfterReleaseRef.current = messageTailScrollMode({
        fromSelf,
        nearTail: nearTailRef.current,
        atBottom: atBottomRef.current,
      });
      setReleasedNewestId(newest.id);
    }
    // else: scrolled up + incoming → leave staged (boundary frozen).
  }, [messages, selfPubkey, proximity, anchored]);

  // Returning from an anchored (jumped-to) window to the live tail — the "jump to
  // latest" button calls `onJumpToTail`, which drops the anchor and reloads a
  // fresh tail window (never paging forward through everything in between). The
  // reload is async, so once the anchor is gone we pin to the newest (offset 0)
  // without animation across the swap — a couple of nudges to catch the tail's
  // layout — rather than animating a long scroll over the stale anchored content.
  const previousTailJumpRef = useRef(tailJumpVersion);
  useEffect(() => {
    if (previousTailJumpRef.current === tailJumpVersion) return;
    previousTailJumpRef.current = tailJumpVersion;
    setLocalFocusId(null); // a far-reply focus (if any) ends when we return to tail
    setReleasedNewestId(null); // show the whole fresh tail
    const toBottom = () =>
      listRef.current?.scrollToOffset({ offset: 0, animated: false });
    const raf = requestAnimationFrame(toBottom);
    const timers = [80, 240].map((ms) => setTimeout(toBottom, ms));
    return () => {
      cancelAnimationFrame(raf);
      timers.forEach(clearTimeout);
    };
  }, [tailJumpVersion]);

  // Follow only explicit sends/retries from this mounted page. Watching the
  // pending store itself is incorrect: route params/store subscriptions can
  // populate one frame after mount, making existing items look newly sent and
  // producing a visible entry scroll.
  const previousPendingTailVersionRef = useRef(pendingTailVersion);
  useEffect(() => {
    if (pendingTailVersion === previousPendingTailVersionRef.current) return;
    previousPendingTailVersionRef.current = pendingTailVersion;
    requestAnimationFrame(() =>
      listRef.current?.scrollToOffset({ offset: 0, animated: true }),
    );
  }, [pendingTailVersion]);

  // A failed attachment grows to reveal Discard / Retry (the attachment itself
  // opens its error details). If the reader was already at the live tail, re-pin
  // after layout so that new action row pushes the bubble upward instead of
  // extending behind the composer.
  // Never steal the viewport while the reader is browsing older messages.
  const previousPendingFailureVersionRef = useRef(pendingFailureVersion);
  useEffect(() => {
    if (pendingFailureVersion === previousPendingFailureVersionRef.current)
      return;
    previousPendingFailureVersionRef.current = pendingFailureVersion;
    if (!atBottomRef.current) return;

    const toBottom = (animated: boolean) =>
      listRef.current?.scrollToOffset({ offset: 0, animated });
    const raf = requestAnimationFrame(() => toBottom(true));
    const timer = setTimeout(() => toBottom(false), 120);
    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(timer);
    };
  }, [pendingFailureVersion]);
  // Rows are merged newest-first for the inverted chat list.
  const messageById = useMemo(() => {
    const map = new Map<string, MessageRow>();
    for (const msg of messages) map.set(msg.id, msg);
    return map;
  }, [messages]);
  const displayedAttachmentUrls = useMemo(() => {
    const urls = new Set<string>();
    for (const message of displayedMessages) {
      if (message.kind === 15) urls.add(message.content.trim());
    }
    return urls;
  }, [displayedMessages]);
  const listItemCache = useMemo(
    () => new WeakMap<MessageRow | PendingAttachment, CachedListItem>(),
    [],
  );

  // A reply target may sit outside the loaded window: fall back to the
  // separately-fetched `referencedById`. Returns null only when the target
  // isn't in the local DB at all (we never received it).
  const resolveTarget = useCallback(
    (id: string): MessageRow | null => messageById.get(id) ?? referencedById[id] ?? null,
    [messageById, referencedById],
  );

  const data = useMemo(() => {
    // Newest-first. The final upload URL is known before publication, so a
    // matching placeholder is hidden in the same render that its DB message
    // first appears. Pending and stored rows are individually sorted, then
    // merged in O(n) so reserved attachment order is preserved without
    // repeatedly sorting the full combined window.
    const pendingItems: ListItemSource[] = [...pendingAttachments]
      .filter(
        (p) =>
          !(p.uploadedUrl && displayedAttachmentUrls.has(p.uploadedUrl)) &&
          !(
            p.status === 'sent' &&
            p.sentRumorId &&
            messageById.has(p.sentRumorId)
          ),
      )
      .sort(
        (a, b) =>
          (b.messageOrderAt ?? (b.startedAt ?? 0) * 1000) -
          (a.messageOrderAt ?? (a.startedAt ?? 0) * 1000),
      )
      .map((p) => ({ kind: 'pending', pending: p }));
    const messageItems: ListItemSource[] = [];
    for (let index = displayedMessages.length - 1; index >= 0; index -= 1) {
      const message = displayedMessages[index];
      const prepared = bubbleRenderItemsById[message.id] ?? null;
      messageItems.push({ kind: 'message', message, prepared });
    }
    const merged: ListItemSource[] = [];
    let pendingIndex = 0;
    let messageIndex = 0;
    while (pendingIndex < pendingItems.length || messageIndex < messageItems.length) {
      const pending = pendingItems[pendingIndex];
      const message = messageItems[messageIndex];
      const pendingOrder = pending?.kind === 'pending'
        ? (pending.pending.messageOrderAt ?? (pending.pending.startedAt ?? 0) * 1000)
        : -Infinity;
      const messageOrder = message?.kind === 'message'
        ? message.message.orderAt
        : -Infinity;
      if (!message || (pending && pendingOrder >= messageOrder)) {
        merged.push(pending);
        pendingIndex += 1;
      } else {
        merged.push(message);
        messageIndex += 1;
      }
    }
    return merged.map((source, index): ListItem => {
      const older = merged[index + 1] ?? null;
      const sourceRow = source.kind === 'message' ? source.message : source.pending;
      const olderSource = older == null
        ? null
        : older.kind === 'message'
          ? older.message
          : older.pending;
      const prepared = source.kind === 'message' ? source.prepared : null;
      const boundaryCreatedAt = older == null ? oldestBoundary?.createdAt : undefined;
      const edgeIsSelf = older == null ? boundaryIsSelf : undefined;
      const cached = listItemCache.get(sourceRow);
      if (
        cached?.prepared === prepared &&
        cached.olderSource === olderSource &&
        cached.boundaryCreatedAt === boundaryCreatedAt &&
        cached.boundaryIsSelf === edgeIsSelf
      ) {
        return cached.item;
      }
      const item = {
        ...source,
        older,
        boundaryCreatedAt,
        boundaryIsSelf: edgeIsSelf,
      } as ListItem;
      listItemCache.set(sourceRow, {
        prepared,
        olderSource,
        boundaryCreatedAt,
        boundaryIsSelf: edgeIsSelf,
        item,
      });
      return item;
    });
  }, [
    bubbleRenderItemsById,
    boundaryIsSelf,
    displayedMessages,
    displayedAttachmentUrls,
    listItemCache,
    oldestBoundary?.createdAt,
    pendingAttachments,
    messageById,
  ]);
  // Live mirror so the stable viewability callback can read the current list.
  const dataRef = useRef(data);
  dataRef.current = data;

  const dataIndexById = useMemo(() => {
    const map = new Map<string, number>();
    data.forEach((it, i) => {
      if (it.kind === 'message') map.set(it.message.id, i);
    });
    return map;
  }, [data]);

  // A direct search/gallery jump waits for its bounded window and target row
  // before mounting the list. The expiry above is the safety net for missing
  // targets or failed loads.
  const focusIndex =
    activeFocusId != null ? (dataIndexById.get(activeFocusId) ?? null) : null;
  const waitingForFocus =
    activeFocusId != null &&
    (focusIndex == null || !windowLoaded) &&
    !focusExpired;

  useElectronHistoryPagination({
    listRef,
    mounted: !waitingForFocus,
    onHistoryEdge: () => {
      continuousHistoryPagingRef.current = true;
      requestOlderFromScroll();
    },
  });

  // Latest index map for imperative jumps.
  const dataIndexByIdRef = useRef(dataIndexById);
  dataIndexByIdRef.current = dataIndexById;

  /** Centre an item after the bounded focus window has committed, then correct
   * once more after variable-height rows have settled under the cover. */
  function snapToCentre(id: string, animatedFirst: boolean): () => void {
    const snap = (animated: boolean) => {
      const i = dataIndexByIdRef.current.get(id);
      if (i != null)
        void listRef.current?.scrollToIndex({
          index: i,
          viewPosition: 0.5,
          animated,
        });
    };
    const raf = requestAnimationFrame(() => snap(animatedFirst));
    const timer = setTimeout(() => snap(false), 220);
    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(timer);
    };
  }

  /** Smoothly scroll a loaded message to the vertical centre — a single animated
   * pass, the clean glide used for reply / seek jumps (the target is already in
   * the window and measured). */
  function smoothCentre(id: string) {
    const i = dataIndexByIdRef.current.get(id);
    if (i != null)
      void listRef.current?.scrollToIndex({
        index: i,
        viewPosition: 0.5,
        animated: true,
      });
  }

  const firstUnreadId = showUnreadDivider ? firstUnreadMessageId : null;
  const unreadTargetLoaded =
    firstUnreadId != null && dataIndexById.has(firstUnreadId);
  const loadedUnreadCount = useMemo(() => {
    if (unreadBoundaryOrderAt == null) return 0;
    const boundaryId = unreadBoundaryId ?? '';
    let count = 0;
    for (let i = messages.length - 1; i >= 0; i--) {
      const message = messages[i];
      const unread =
        message.orderAt > unreadBoundaryOrderAt ||
        (boundaryId !== '' &&
          message.orderAt === unreadBoundaryOrderAt &&
          message.id < boundaryId);
      if (!unread) break;
      count += 1;
    }
    return count;
  }, [messages, unreadBoundaryOrderAt, unreadBoundaryId]);

  // Paint the first page immediately, then grow the tail window quietly until
  // the exact divider row is present. `unreadCount` is capped by the service, so
  // this background work remains bounded; a larger unread tail uses the direct
  // anchor fallback in `scrollToUnread` instead of loading unbounded history.
  useEffect(() => {
    if (
      !tailMode ||
      !showUnreadDivider ||
      firstUnreadId == null ||
      unreadTargetLoaded ||
      !hasMore ||
      loadedUnreadCount >= unreadCount
    ) {
      return;
    }
    onLoadOlder();
  }, [
    tailMode,
    showUnreadDivider,
    firstUnreadId,
    unreadTargetLoaded,
    hasMore,
    loadedUnreadCount,
    unreadCount,
    onLoadOlder,
  ]);
  // Live mirror of its row index for the stable viewability callback (same
  // pattern as `dataRef`). Null → no target; the jump button is gated on
  // `firstUnreadId` at render, so a stale `unreadDir` can't surface it.
  const firstUnreadIndexRef = useRef<number | null>(null);
  firstUnreadIndexRef.current =
    firstUnreadId != null ? (dataIndexById.get(firstUnreadId) ?? null) : null;

  /** Jump to where the user left off, landing the unread divider about a fifth
   * down from the top so the first unread message and everything after it reads
   * downward. Inversion flips viewPosition, so a fifth from the top is 0.8. */
  function scrollToUnread() {
    if (firstUnreadId == null || firstUnreadOrderAt == null) return;
    const idx = dataIndexById.get(firstUnreadId);
    if (idx == null) {
      setLocalFocusId(firstUnreadId);
      onFocusAnchor({ id: firstUnreadId, orderAt: firstUnreadOrderAt });
      return;
    }
    listRef.current?.scrollToIndex({
      index: idx,
      viewPosition: 0.8,
      animated: true,
    });
  }
  const unreadAbove =
    !anchored &&
    firstUnreadId != null &&
    (!unreadTargetLoaded || unreadDir === 'above');
  const unreadBelow =
    !anchored && unreadDir === 'below' && firstUnreadId != null;
  const showFloatingScrollDown =
    showScrollDown ||
    stagedCount > 0 ||
    unreadAbove ||
    unreadBelow ||
    hasMoreNewer;

  function handleFloatingScrollDown() {
    if ((unreadAbove || unreadBelow) && stagedCount === 0) {
      scrollToUnread();
      return;
    }
    scrollToBottom();
  }

  /** Scroll to a message by id. A reply target is almost always just up the
   * thread, so the seek effect **pages older toward it** (rather than re-anchoring,
   * which would flash the whole list and lose the reader's bearings), ensures
   * there's room above it to centre on, then scrolls — handling the in-window,
   * near-top, and out-of-window cases uniformly. Only a genuinely distant target
   * (past `MAX_SEEK_PAGES`) falls back to a re-anchored jump. */
  const scrollToMessage = useCallback((id: string) => {
    if (dataIndexById.get(id) == null && !referencedById[id]) return; // unreachable
    seekAttemptsRef.current = 0;
    setSeekReplyId(id);
  }, [dataIndexById, referencedById, setSeekReplyId]);

  // A jump target (search / gallery open, or a far reply): the window loads
  // centred on it, then the target flashes only once the positioning cover lifts.
  // Once per focus id, so growing the window afterwards doesn't re-flash. The
  // handled guard is committed with the reveal; cancelling the timer can retry.
  const focusHandledRef = useRef<string | null>(null);
  useEffect(() => {
    if (!activeFocusId) {
      focusHandledRef.current = null;
      return;
    }
    if (focusHandledRef.current === activeFocusId) return;
    // Position only once the window is fully loaded and mounted (otherwise the
    // list ref is null / the index isn't final). The whole small window is
    // rendered by now, so `scrollToIndex` is exact.
    if (!windowLoaded) return;
    if (dataIndexById.get(activeFocusId) == null) return;
    const id = activeFocusId;
    const cancel = snapToCentre(id, false);
    // Reveal *after* the final re-snap, so the brief settle while media bubbles
    // measure their real height stays hidden under the cover (no visible jump).
    // Arm the flash in this same commit so loading and hidden positioning consume
    // none of its visible hold/fade duration.
    const revealT = setTimeout(() => {
      focusHandledRef.current = id;
      setReady(true);
      flash(id);
    }, 280);
    return () => {
      cancel();
      clearTimeout(revealT);
    };
  }, [activeFocusId, dataIndexById, windowLoaded]);

  // Seek a tapped reply target by paging older toward it. Each older page that
  // lands re-runs this (via `dataIndexById`). We scroll only once the target is
  // present *and* has `SEEK_MARGIN` older rows above it (or there's no older left)
  // — so it can sit mid-screen instead of clamping to the very top. MVCP holds the
  // view steady while paging, so the final move reads as one smooth scroll up — no
  // flash. If it isn't reached within `MAX_SEEK_PAGES` (too far for a smooth
  // scroll), hand it to the focus machinery (`localFocusId` + `onFocusAnchor`):
  // the same proven jump as a search/gallery open — re-anchor, render the small
  // window whole, snap to centre under the cover — which lands exactly where a
  // single mid-chat scroll over not-yet-measured rows would not.
  useEffect(() => {
    if (!seekReplyId) return;
    const idx = dataIndexById.get(seekReplyId);
    const roomAbove =
      idx != null && (data.length - 1 - idx >= SEEK_MARGIN || !hasMore);
    if (roomAbove) {
      const id = seekReplyId;
      setSeekReplyId(null);
      smoothCentre(id);
      flash(id);
      return;
    }
    if (hasMore && seekAttemptsRef.current < MAX_SEEK_PAGES) {
      seekAttemptsRef.current += 1;
      onLoadOlder();
      return;
    }
    // Cap hit. If the target did load (just too near the top to centre), scroll to
    // it best-effort; otherwise it's genuinely distant — jump to it via the focus
    // machinery.
    const id = seekReplyId;
    setSeekReplyId(null);
    if (idx != null) {
      smoothCentre(id);
      flash(id);
      return;
    }
    const target = referencedById[id];
    if (target) {
      setLocalFocusId(id);
      onFocusAnchor({ id, orderAt: target.orderAt });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dataIndexById, seekReplyId, hasMore]);

  const repliedSenderPubkeys = useMemo(() => {
    const set = new Set<string>();
    for (const m of messages) {
      if (m.replyToId) {
        const target =
          messageById.get(m.replyToId) ?? referencedById[m.replyToId];
        if (target) set.add(target.senderPubkey);
      }
    }
    for (const pending of pendingAttachments) {
      if (!pending.replyToId) continue;
      const target =
        messageById.get(pending.replyToId) ?? referencedById[pending.replyToId];
      if (target) set.add(target.senderPubkey);
    }
    return Array.from(set);
  }, [messages, messageById, referencedById, pendingAttachments]);

  const profileMap = useProfilesMap(repliedSenderPubkeys, liveDataEnabled);

  // Private petnames (local nicknames) win over the published name in reply
  // previews too — same rule as the chat header and lists.
  const contactsByPubkey = useContactsMap(
    accountPubkey,
    repliedSenderPubkeys,
    liveDataEnabled,
  );
  const petnameByPubkey = useMemo(() => {
    const m: Record<string, string> = {};
    for (const [pubkey, contact] of Object.entries(contactsByPubkey)) {
      if (contact.petname) m[pubkey] = contact.petname;
    }
    return m;
  }, [contactsByPubkey]);
  const replySenderName = useCallback((
    senderPubkey: string,
    profile?: { displayName?: string | null; name?: string | null } | null,
  ) => {
    if (proximity) {
      return senderPubkey !== conversationKey
        ? t('common.you')
        : peerDisplayName || resolveDisplayName(senderPubkey);
    }
    return resolveDisplayName(senderPubkey, {
      petname: petnameByPubkey[senderPubkey],
      displayName: profile?.displayName,
      name: profile?.name,
    });
  }, [conversationKey, peerDisplayName, petnameByPubkey, proximity, t]);
  // Parent callbacks can change while scrolling chrome updates. Cell handlers
  // read their latest versions without changing FlatList's renderItem identity.
  const rowActionsRef = useRef({
    onSwipeReply,
    onLongPress,
    onLongPressPending,
    onTapReaction,
    onShowDelivery,
    onStopPending,
    onRetryPending,
    onCancelPending,
    onToggleSelect,
    tailMode,
  });
  useLayoutEffect(() => {
    rowActionsRef.current = {
      onSwipeReply,
      onLongPress,
      onLongPressPending,
      onTapReaction,
      onShowDelivery,
      onStopPending,
      onRetryPending,
      onCancelPending,
      onToggleSelect,
      tailMode,
    };
  }, [
    onSwipeReply, onLongPress, onLongPressPending, onTapReaction,
    onShowDelivery, onStopPending, onRetryPending, onCancelPending,
    onToggleSelect, tailMode,
  ]);

  const canSwipeReply = onSwipeReply != null;
  const canShowDelivery = onShowDelivery != null;
  const renderItem = useCallback(
    ({ item }: ListRenderItemInfo<ListItem>) => {
      const older = item.older;
      if (item.kind === 'pending') {
        // Pending attachments are always our own. Match MessageBubble's
        // sender-run spacing: tight after another own row, wider after a peer.
        const olderIsSelf =
          older?.kind === 'pending' ||
          (older?.kind === 'message' &&
            isMessageFromSelf(older.message, selfPubkey, proximity));
        const replyId = item.pending.replyToId;
        const target = replyId ? resolveTarget(replyId) : null;
        const profile = target ? profileMap[target.senderPubkey] : null;
        const replyPreview: MessageBubbleReplyPreview | null = target
          ? {
              senderPubkey: target.senderPubkey,
              senderDisplayName: replySenderName(
                target.senderPubkey,
                profile,
              ),
              contentPreview:
                target.kind === 15
                  ? attachmentLabel(target.tags, attachmentLabels)
                  : target.content,
            }
          : replyId
            ? {
                senderPubkey: '',
                senderDisplayName: null,
                contentPreview: '…',
              }
            : null;
        const dateLabel = startsLoadedTimelineDay(
          item,
          older ?? undefined,
          item.boundaryCreatedAt,
        )
          ? formatDateSeparator(timelineItemCreatedAt(item))
          : null;
        return (
          <>
            <PendingAttachmentBubble
              pending={item.pending}
              onStop={(id) => rowActionsRef.current.onStopPending(id)}
              onRetry={(id) => rowActionsRef.current.onRetryPending(id)}
              onCancel={(id) => {
                pinTailAfterPendingRemovalRef.current =
                  rowActionsRef.current.tailMode && atBottomRef.current;
                rowActionsRef.current.onCancelPending(id);
              }}
              groupStart={startsLoadedSenderGroup(
                true,
                older ? olderIsSelf : item.boundaryIsSelf,
              )}
              replyTo={replyPreview}
              onPressReply={
                replyId ? () => scrollToMessage(replyId) : undefined
              }
              onLongPress={
                item.pending.status === 'failed' && !selectionMode
                  ? (rect) =>
                      rowActionsRef.current.onLongPressPending(item.pending, rect, {
                        content: '',
                        isSelf: true,
                        createdAt: item.pending.startedAt ?? 0,
                        renderBody: (
                          <PendingAttachmentBubble
                            pending={item.pending}
                            onStop={() => {}}
                            onRetry={() => {}}
                            onCancel={() => {}}
                            replyTo={replyPreview}
                            lifted
                          />
                        ),
                      })
                  : undefined
              }
            />
            {dateLabel ? <DateSeparator label={dateLabel} /> : null}
          </>
        );
      }
      const msg = item.message;
      const preparedRow = item.prepared;
      const olderMessageId =
        older?.kind === 'message' ? older.message.id : null;
      const preparedNeighboursMatch =
        preparedRow != null &&
        ((older?.kind === 'message' && preparedRow.olderMessageId === olderMessageId) ||
          (!older && preparedRow.olderMessageId == null));

      // When the older neighbour is on a different day (or the loaded boundary
      // is), this message starts a new day and gets a separator above it.
      const showDate = !older
        ? startsLoadedTimelineDay(item, undefined, item.boundaryCreatedAt)
        : preparedNeighboursMatch
          ? preparedRow.showDate
          : startsTimelineDay(item, older);
      const dateLabel = showDate
        ? formatDateSeparator(msg.createdAt)
        : null;
      // The unread divider sits above the first message past the watermark.
      const showUnread = msg.id === firstUnreadId;

      let replyPreview: MessageBubbleReplyPreview | null = null;
      if (msg.replyToId) {
        const target =
          preparedRow?.replyTarget ?? resolveTarget(msg.replyToId);
        if (target) {
          const profile = profileMap[target.senderPubkey];
          replyPreview = {
            senderPubkey: target.senderPubkey,
            senderDisplayName: replySenderName(
              target.senderPubkey,
              profile,
            ),
            contentPreview:
              target.kind === 15
                ? attachmentLabel(target.tags, attachmentLabels)
                : target.content,
          };
        } else {
          // Not in the window and not in the local DB — we never received it.
          replyPreview = {
            senderPubkey: '',
            senderDisplayName: null,
            contentPreview: '…',
          };
        }
      }

      const reactions =
        preparedRow?.reactions ?? reactionsByMessageId[msg.id] ?? [];
      const presentation =
        preparedRow?.presentation ??
        presentationsByMessageId[msg.id] ??
        prepareMessagePresentation({
          messageId: msg.id,
          kind: msg.kind,
          content: msg.content,
          tags: msg.tags,
        });
      const attachment = presentation.attachment;
      const isSelf = isMessageFromSelf(msg, selfPubkey, proximity);
      const persistedDelivery = deliveriesByMessageId[msg.id] ??
        (msg.deliveryStatus
          ? {
              rumorId: msg.id,
              phase: msg.deliveryStatus,
              copies: [],
            }
          : null);
      // Starts a new sender run (wider top gap) when the older neighbour is from
      // a different sender — in a 1:1
      // thread that's exactly each self ↔ other switch. Consecutive same-sender
      // messages stay tight.
      const olderIsSelf =
        older?.kind === 'pending' ||
        (older?.kind === 'message' &&
          isMessageFromSelf(older.message, selfPubkey, proximity));
      const groupStart = !older
        ? startsLoadedSenderGroup(isSelf, item.boundaryIsSelf)
        : preparedNeighboursMatch
        ? preparedRow.groupStart
        : !older || isSelf !== olderIsSelf;

      return (
        <>
          <MessageBubble
            content={msg.content}
            tags={msg.tags}
            isSelf={isSelf}
            createdAt={msg.createdAt}
            orderAt={msg.orderAt}
            rumorId={msg.id}
            persistedDelivery={persistedDelivery}
            replyTo={replyPreview}
            reactions={reactions}
            attachment={attachment}
            presentation={presentation}
            interactive={interactive}
            conversationKey={msg.conversationKey}
            proximity={proximity}
            remoteContentMode={remoteContentMode}
            // While selecting, disable swipe/long-press so a tap toggles instead.
            onSwipeReply={
              selectionMode || !canSwipeReply
                ? undefined
                : () => rowActionsRef.current.onSwipeReply?.(msg)
            }
            onLongPress={
              selectionMode
                ? undefined
                : (rect) =>
                    rowActionsRef.current.onLongPress(msg, rect, {
                      content: msg.content,
                      tags: msg.tags,
                      isSelf,
                      createdAt: msg.createdAt,
                      rumorId: msg.id,
                      persistedDelivery,
                      replyTo: replyPreview,
                      attachment,
                      remoteContentMode,
                      reactions,
                    })
            }
            onShowDelivery={
              canShowDelivery ? () => rowActionsRef.current.onShowDelivery?.(msg.id) : undefined
            }
            onPressReply={
              msg.replyToId
                ? () => scrollToMessage(msg.replyToId!)
                : undefined
            }
            highlighted={flashTarget?.id === msg.id}
            highlightTick={
              flashTarget?.id === msg.id ? flashTarget.tick : 0
            }
            groupStart={groupStart}
            separatorAbove={showUnread}
            onTapReaction={(r) => rowActionsRef.current.onTapReaction(msg, r)}
            selectionMode={selectionMode}
            selectionShiftStyle={selectionShiftStyle}
            selected={selectedIds?.has(msg.id) ?? false}
            onToggleSelect={() => rowActionsRef.current.onToggleSelect?.(msg.id)}
          />
          {showUnread ? (
            <UnreadDivider label={t('chat.unread_divider')} />
          ) : null}
          {dateLabel ? <DateSeparator label={dateLabel} /> : null}
        </>
      );
    },
    [
      attachmentLabels, canShowDelivery, canSwipeReply,
      deliveriesByMessageId, firstUnreadId, flashTarget, interactive,
      presentationsByMessageId, profileMap,
      proximity, reactionsByMessageId, remoteContentMode, replySenderName,
      resolveTarget, scrollToMessage, selectedIds, selectionMode,
      selectionShiftStyle, selfPubkey, t,
    ],
  );
  return (
    <View style={{ flex: 1 }}>
      {!waitingForFocus ? (
        <FlatList
          ref={listRef}
          data={data}
          style={{
            opacity: pendingInitialPosition.ready ? 1 : 0,
            pointerEvents: pendingInitialPosition.ready ? 'auto' : 'none',
          }}
          accessibilityElementsHidden={!pendingInitialPosition.ready}
          importantForAccessibility={
            pendingInitialPosition.ready ? 'auto' : 'no-hide-descendants'
          }
          onContentSizeChange={handleContentSizeChange}
          onLayout={(event) => {
            const viewportHeight = event.nativeEvent.layout.height;
            scrollMetricsRef.current.viewportHeight = viewportHeight;
            const { contentHeight } = scrollMetricsRef.current;
            if (contentHeight > 0 && contentHeight <= viewportHeight) {
              requestOlderFromScroll(true);
            }
          }}
          inverted
          maintainVisibleContentPosition={
            shouldMaintainVisibleMessagePosition({
              anchored,
              initialPositionReady: pendingInitialPosition.ready,
            })
              ? ANCHORED_VISIBLE_POSITION
              : undefined
          }
          initialNumToRender={activeFocusId != null ? 60 : MESSAGES_PAGE_SIZE}
          maxToRenderPerBatch={activeFocusId != null ? 60 : MESSAGES_PAGE_SIZE}
          updateCellsBatchingPeriod={
            activeFocusId != null ? 0 : MESSAGE_CELL_RENDER_BATCH_PERIOD_MS
          }
          // Retain FlatList's full two-sided Android fling buffer. Database pages
          // are exposed incrementally, while FlatList owns view virtualization;
          // reducing this window causes visible blanks on fast flings.
          windowSize={21}
          // Android clipping and inverted transforms can detach visible cells.
          // Virtualization still unmounts rows outside the render window.
          removeClippedSubviews={false}
          onScrollBeginDrag={handleScrollBeginDrag}
          onScrollEndDrag={handleScrollSettled}
          onMomentumScrollBegin={handleMomentumScrollBegin}
          onMomentumScrollEnd={handleScrollSettled}
          onScroll={(e) => {
            const y = e.nativeEvent.contentOffset.y;
            const movingOlder = y > scrollMetricsRef.current.offsetY;
            scrollMetricsRef.current = {
              offsetY: y,
              viewportHeight: e.nativeEvent.layoutMeasurement.height,
              contentHeight: e.nativeEvent.contentSize.height,
            };
            if (movingOlder && userScrollInProgressRef.current &&
                isNearMessageHistoryEdge({
                  offsetY: y,
                  contentHeight: e.nativeEvent.contentSize.height,
                  viewportHeight: e.nativeEvent.layoutMeasurement.height,
                })) {
              requestOlderFromScroll();
            }
            const nearTail = isNearMessageTail(y);
            const show = !nearTail;
            if (showScrollDownRef.current !== show) {
              showScrollDownRef.current = show;
              setShowScrollDown(show);
            }
            nearTailRef.current = nearTail;
            const atBottom = y < 24;
            atBottomRef.current = !userScrollInProgressRef.current && atBottom;
            // Cross the React boundary only when the floating-date visibility
            // changes. Gesture-end callbacks arm the idle fade once per scroll.
            if (atBottom) {
              clearFloatingActive();
            } else if (!floatingActiveRef.current) {
              activateFloatingDate(!userScrollInProgressRef.current);
            }
          }}
          scrollEventThrottle={64}
          onViewableItemsChanged={handleViewableItemsChanged}
          viewabilityConfig={viewabilityConfig}
          keyExtractor={(item) =>
            item.kind === 'message'
              ? `m:${item.message.id}`
              : `p:${item.pending.tempId}`
          }
          renderItem={renderItem}
          // Inverted list end = oldest → load an older page.
          onEndReached={() => {
            requestOlderFromScroll();
          }}
          onEndReachedThreshold={MESSAGE_HISTORY_PREFETCH_VIEWPORTS}
          // Inverted list start = newest → in an anchored window page forward;
          // in tail mode
          // reveal whatever was staged while the user read up. Also gated on `ready`:
          // a jump-open mounts at the bottom, so this would otherwise fire instantly
          // and `loadNewer` would move the target mid-positioning (the cause of jumps
          // landing near, but not on, the target).
          onStartReached={() => {
            if (!ready) return;
            if (hasMoreNewer) {
              onLoadNewer();
            } else if (stagedCount > 0) {
              releaseStaged();
            }
          }}
          onStartReachedThreshold={1}
          onScrollToIndexFailed={(info) => {
            setTimeout(() => {
              listRef.current?.scrollToIndex({
                index: info.index,
                viewPosition: 0.5,
                animated: false,
              });
            }, 80);
          }}
          ListFooterComponent={
              <View style={{ height: topInset, justifyContent: 'center' }}>
                {loadingOlder ? <ActivityIndicator color={c.textMuted} /> : null}
              </View>
          }
          ListHeaderComponent={
              <View
                style={{
                  height: bottomInset + spacing.md,
                  justifyContent: 'center',
                }}
              >
                {loadingNewer ? <ActivityIndicator color={c.textMuted} /> : null}
              </View>
          }
        />
      ) : null}
      {/* Floating sticky date header — overlaid at the top, identical capsule to
          the inline separators, parked at their resting position (marginTop 8). */}
      <Animated.View
        style={[
          {
            position: 'absolute',
            top: topInset + spacing.sm,
            left: 0,
            right: 0,
            alignItems: 'center',
          },
          floatingStyle,
          { pointerEvents: 'none' },
        ]}
      >
        {floatingDate ? <DatePill label={floatingDate} /> : null}
      </Animated.View>
      {/* Single bottom-right scroll control. The badge means staged messages
          that arrived while reading history; it is not the unread-divider count. */}
      <View
        style={{
          position: 'absolute',
          end: spacing.lg,
          bottom: bottomInset + spacing.lg,
          alignItems: 'center',
          gap: 10,
        }}
      >
        {/* A bidirectional jump can page toward the present; this remains the
            shortcut straight back to the live tail. */}
        {showFloatingScrollDown ? (
          <View>
            <View
              style={{
                width: 40,
                height: 40,
                borderRadius: radius.full,
                ...shadow.float,
              }}
            >
              <View
                style={{
                  position: 'absolute',
                  top: 0,
                  right: 0,
                  bottom: 0,
                  left: 0,
                  borderRadius: radius.full,
                  overflow: 'hidden',
                  pointerEvents: 'none',
                }}
              >
                <FrostedBackdrop surface="surfaceElevated" />
              </View>
              <IconButton
                accessibilityLabel={t(
                  unreadAbove && stagedCount === 0
                    ? 'chat.scroll_to_unread'
                    : 'chat.scroll_to_latest',
                )}
                icon={
                  unreadAbove && stagedCount === 0 ? (
                    <ChevronUp strokeWidth={iconStrokeWidth.default} size={22} color={c.text} />
                  ) : (
                    <ChevronDown strokeWidth={iconStrokeWidth.default} size={22} color={c.text} />
                  )
                }
                onPress={handleFloatingScrollDown}
                size={40}
                variant="plain"
                style={{ zIndex: 1 }}
              />
            </View>
            {showNewMessageIndicators && stagedCount > 0 ? (
              <View
                style={{
                  position: 'absolute',
                  top: -8,
                  end: -8,
                  pointerEvents: 'none',
                }}
              >
                <CountBadge count={stagedCount} tone="notification" />
              </View>
            ) : null}
          </View>
        ) : null}
      </View>
      {!ready ? (
        <View
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: c.background,
            pointerEvents: 'none',
          }}
        />
      ) : null}
    </View>
  );
}
