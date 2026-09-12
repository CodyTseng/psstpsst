import { ChatRoundDots as MessageCircleMore } from '@solar-icons/react-native/category/messages/Linear/ChatRoundDots';
import { ChatRound as MessageCircle } from '@solar-icons/react-native/category/messages/Linear/ChatRound';
import { Bell } from '@solar-icons/react-native/category/notifications/Linear/Bell';
import { BellOff as BellOffBold } from '@solar-icons/react-native/category/notifications/Bold/BellOff';
import { BellOff } from '@solar-icons/react-native/category/notifications/Linear/BellOff';
import { Pin } from '@solar-icons/react-native/category/ui/Linear/Pin';
import { TrashBinTrash as Trash2 } from '@solar-icons/react-native/category/ui/Linear/TrashBinTrash';
import type { ComponentProps, ComponentType } from 'react';
import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Animated as RNAnimated, Platform, StyleSheet, View } from 'react-native';

import {
  InteractivePressable as Pressable,
  isInteractiveHovered,
} from '@/components/common/InteractivePressable';
import { Swipeable } from 'react-native-gesture-handler';
import Animated, {
  interpolate,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';

import { BlockedBadge } from '@/components/blocked/BlockedBadge';
import { Avatar } from '@/components/common/Avatar';
import { MessagePreviewText } from '@/components/chat/MessagePreviewText';
import { AppText } from '@/components/common/AppText';
import {
  CONTEXT_MENU_ICON_SIZE,
  ContextMenu,
  type ContextMenuAnchor,
  type ContextMenuItem,
} from '@/components/common/ContextMenu';
import { CountBadge } from '@/components/common/CountBadge';
import { InteractionOverlay } from '@/components/common/InteractionOverlay';
import { NearbyBadge } from '@/components/common/NearbyBadge';
import { SelfBadge } from '@/components/common/SelfBadge';
import { SwipeAction, SWIPE_ACTION_WIDTH } from '@/components/common/swipe-action';
import { useIsBlocked } from '@/hooks/use-blocked';
import { useContact } from '@/hooks/use-contacts';
import { useElectronFileDrop } from '@/hooks/use-electron-file-drop';
import { useIsRTL } from '@/i18n/direction';
import { useProfile } from '@/hooks/use-profile';
import {
  BACK_SWIPE_GUARD,
  clearOpenSwipeable,
  closeIfOpen,
  closeOpenSwipeable,
  registerOpenSwipeable,
} from '@/lib/gestures';
import { resolveDisplayName } from '@/lib/nostr/display-name';
import type { ComposerFile } from '@/lib/attachments/composer-file';
import { IS_ELECTRON, type DesktopContextMenuEvent } from '@/lib/platform';
import { formatListTime } from '@/lib/time';
import { platform } from '@/platform';
import { beginChatOpenTrace, markChatNavigation } from '@/lib/perf/chat-open';
import { useActiveAccount } from '@/stores/active-account.store';
import { useDraftsStore } from '@/stores/drafts.store';
import { useProximityStore } from '@/stores/proximity.store';
import { spacing, typography, uiDensity, useThemeColors } from '@/theme';

type Props = {
  conversationKey: string;
  counterpartyPubkey: string | null;
  conversationName: string | null;
  /** Optional in-memory picture used instead of a live profile picture. */
  conversationPicture?: string | number | null;
  lastMessagePreview: string | null;
  lastMessageTags?: string[][] | null;
  lastMessageFromSelf?: boolean;
  lastMessageAt: number;
  unreadCount: number;
  muted: boolean;
  identityKind?: 'relay' | 'proximity';
  /** Pinned to the top of the inbox (floated off the page with a surface fill). */
  pinned?: boolean;
  /** Briefly flashes after a Chats-tab re-press jumps to this unread row. */
  highlighted?: boolean;
  /** Bumped on every flash request so repeating the same target replays it. */
  highlightTick?: number;
  /** Persistent primary-pane selection for the conversation shown beside it. */
  active?: boolean;
  /** Whether an unselected press may paint the same wash used for selection.
   * Wide layouts disable this and use their quieter dedicated hover wash. */
  showPressedFill?: boolean;
  /** Disable profile, contact, and block reads for in-memory fixture rows. */
  liveDataEnabled?: boolean;
  onPress: (
    conversationKey: string,
    identityKind: 'relay' | 'proximity',
    name: string | null,
  ) => void;
  /** Electron-only file drop routed through this conversation row. */
  onDropFiles?: (
    conversationKey: string,
    identityKind: 'relay' | 'proximity',
    name: string | null,
    files: ComposerFile[],
  ) => void;
  onToggleMute: (conversationKey: string, muted: boolean) => void;
  /** Provided only where pinning applies (the main inbox) — when omitted, the
   * pin swipe action is hidden. */
  onTogglePin?: (conversationKey: string, pinned: boolean) => void;
  /** Toggle read/unread (leading swipe). Omitted where it doesn't apply, hiding
   * the action. The direction is derived from `unreadCount`. */
  onToggleUnread?: (conversationKey: string, unreadCount: number) => void;
  onDelete: (conversationKey: string) => void;
};

const ACTION_WIDTH = SWIPE_ACTION_WIDTH;

type DesktopPressableProps = ComponentProps<typeof Pressable> & {
  onContextMenu?: (event: DesktopContextMenuEvent) => void;
};

const DesktopPressable = Pressable as ComponentType<DesktopPressableProps>;

/** A centered icon-over-label layer that fills its parent — stacked twice in the
 * delete cell so the label can cross-fade as the cell grows. */
function DeleteFace({ label, color }: { label: string; color: string }) {
  return (
    <View
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        alignItems: 'center',
        justifyContent: 'center',
        gap: 4,
      }}
    >
      <Trash2 size={20} color={color} />
      <AppText variant="caption" weight="medium" numberOfLines={1} style={{ color }}>
        {label}
      </AppText>
    </View>
  );
}

/**
 * Trailing (right→left) swipe actions: Mute + Delete. Delete is a two-step
 * confirm — but instead of swapping cells, the red Delete cell **grows** left to
 * cover Mute (its width animates 1→2 cells) while its label cross-fades from
 * "Delete" to "Confirm delete". The container stays a fixed 2-cell width so the
 * row never shifts. The Mute cell sits underneath and is covered (so untappable)
 * once confirming.
 */
function TrailingActions({
  confirming,
  muted,
  muteLabel,
  deleteLabel,
  confirmLabel,
  onToggleMute,
  onRequestConfirm,
  onConfirmDelete,
}: {
  confirming: boolean;
  muted: boolean;
  muteLabel: string;
  deleteLabel: string;
  confirmLabel: string;
  onToggleMute: () => void;
  onRequestConfirm: () => void;
  onConfirmDelete: () => void;
}) {
  const c = useThemeColors();
  const progress = useSharedValue(0);
  useEffect(() => {
    progress.value = withTiming(confirming ? 1 : 0, { duration: 200 });
  }, [confirming, progress]);

  const redStyle = useAnimatedStyle(() => ({
    width: interpolate(progress.value, [0, 1], [ACTION_WIDTH, ACTION_WIDTH * 2]),
  }));
  const deleteFaceStyle = useAnimatedStyle(() => ({ opacity: 1 - progress.value }));
  const confirmFaceStyle = useAnimatedStyle(() => ({ opacity: progress.value }));

  return (
    <View style={{ width: ACTION_WIDTH * 2, height: '100%' }}>
      {/* Mute — under the expanding red, covered once confirming. */}
      <Pressable
        onPress={onToggleMute}
        fallbackHoverOpacity={false}
        style={{
          position: 'absolute',
          start: 0,
          top: 0,
          bottom: 0,
          width: ACTION_WIDTH,
          alignItems: 'center',
          justifyContent: 'center',
          gap: 4,
          backgroundColor: c.warning + '22',
        }}
      >
        {({ pressed }) => (
          <>
            {pressed ? <InteractionOverlay /> : null}
            {muted ? (
              <Bell size={20} color={c.warning} />
            ) : (
              <BellOff size={20} color={c.warning} />
            )}
            <AppText variant="caption" weight="medium" style={{ color: c.warning }}>
              {muteLabel}
            </AppText>
          </>
        )}
      </Pressable>

      {/* Delete — anchored right, grows left to cover Mute on confirm. */}
      <Animated.View
        style={[
          {
            position: 'absolute',
            end: 0,
            top: 0,
            bottom: 0,
            overflow: 'hidden',
            backgroundColor: c.danger,
          },
          redStyle,
        ]}
      >
        <Pressable
          onPress={() => (confirming ? onConfirmDelete() : onRequestConfirm())}
          fallbackHoverOpacity={false}
          style={{ flex: 1 }}
        >
          {({ pressed }) => (
            <>
              {pressed ? <InteractionOverlay /> : null}
              <Animated.View style={[StyleSheet.absoluteFill, deleteFaceStyle]}>
                <DeleteFace label={deleteLabel} color={c.onOverlay} />
              </Animated.View>
              <Animated.View style={[StyleSheet.absoluteFill, confirmFaceStyle]}>
                <DeleteFace label={confirmLabel} color={c.onOverlay} />
              </Animated.View>
            </>
          )}
        </Pressable>
      </Animated.View>
    </View>
  );
}

function ConversationListItemBase({
  conversationKey,
  counterpartyPubkey,
  conversationName,
  conversationPicture,
  lastMessagePreview,
  lastMessageTags,
  lastMessageFromSelf,
  lastMessageAt,
  unreadCount,
  muted,
  identityKind = 'relay',
  pinned,
  highlighted,
  highlightTick,
  active = false,
  showPressedFill = true,
  liveDataEnabled = true,
  onPress,
  onDropFiles,
  onToggleMute,
  onTogglePin,
  onToggleUnread,
  onDelete,
}: Props) {
  const { t } = useTranslation();
  const c = useThemeColors();
  const isRTL = useIsRTL();
  const [highlight] = useState(() => new RNAnimated.Value(0));
  const accountPubkey = useActiveAccount((s) => s.activePubkey) ?? '';
  const proximityConnectionStatus = useProximityStore((state) =>
    identityKind === 'proximity'
      ? (state.peers[conversationKey]?.connectionStatus ?? 'disconnected')
      : 'disconnected',
  );
  const profile = useProfile(counterpartyPubkey, liveDataEnabled);
  // Two-step delete: the first Delete tap morphs the whole trailing action set
  // into a single "Confirm delete" button; the swipe closing (or sliding back)
  // resets it. Replaces the old confirmation Alert with an inline confirm.
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [contextMenuAnchor, setContextMenuAnchor] =
    useState<ContextMenuAnchor | null>(null);
  // Private petname (1:1 alias) wins over the published name, matching the
  // profile/contacts screens.
  const contact = useContact(accountPubkey, counterpartyPubkey ?? '', liveDataEnabled);
  const blocked = useIsBlocked(accountPubkey, counterpartyPubkey ?? '', liveDataEnabled) === true;
  const swipeableRef = useRef<Swipeable>(null);
  const suppressDesktopSwipeReleaseRef = useRef(false);
  const openingRef = useRef(false);
  const openingResetFrameRef = useRef<number | null>(null);
  // Stable identity (not a per-render closure) so the single-open registry's
  // identity checks hold across re-renders.
  const closeSwipe = useCallback(() => swipeableRef.current?.close(), []);

  const closeContextMenu = useCallback(() => {
    setContextMenuAnchor(null);
  }, []);

  const handleDropFiles = useCallback(
    (files: ComposerFile[]) => {
      if (!onDropFiles) return;
      closeContextMenu();
      closeOpenSwipeable();
      onDropFiles(conversationKey, identityKind, conversationName, files);
    },
    [closeContextMenu, conversationKey, conversationName, identityKind, onDropFiles],
  );
  const { targetRef: fileDropTargetRef, active: fileDragActive } =
    useElectronFileDrop({
      enabled: !!onDropFiles,
      onDropFiles: handleDropFiles,
    });

  const handleContextMenu = useCallback((event: DesktopContextMenuEvent) => {
    if (!IS_ELECTRON) return;
    event.preventDefault?.();
    event.stopPropagation?.();
    closeOpenSwipeable();
    const source = event.nativeEvent;
    const x = event.pageX ?? source?.pageX ?? source?.clientX;
    const y = event.pageY ?? source?.pageY ?? source?.clientY;
    if (x === undefined || y === undefined) return;
    setContextMenuAnchor({ x, y });
  }, []);

  useEffect(
    () => () => {
      if (openingResetFrameRef.current != null) {
        cancelAnimationFrame(openingResetFrameRef.current);
      }
    },
    [],
  );

  // The note-to-self conversation is just a 1:1 with yourself — show your own
  // name, resolved like any peer (the `SelfBadge` marks that it's genuinely you).
  const isSelf = !!counterpartyPubkey && counterpartyPubkey === accountPubkey;
  const displayName =
    conversationName ||
    resolveDisplayName(counterpartyPubkey ?? '', {
      petname: contact?.petname,
      displayName: profile?.displayName,
      name: profile?.name,
    });

  const unread = unreadCount > 0;
  const contextMenuItems: ContextMenuItem[] = [];
  if (contextMenuAnchor && onToggleUnread) {
    contextMenuItems.push({
      key: 'unread',
      title: t(unread ? 'conversations.read' : 'conversations.unread'),
      icon: unread ? (
        <MessageCircle size={CONTEXT_MENU_ICON_SIZE.pointer} color={c.text} />
      ) : (
        <MessageCircleMore size={CONTEXT_MENU_ICON_SIZE.pointer} color={c.text} />
      ),
      onPress: () => onToggleUnread(conversationKey, unreadCount),
    });
  }
  if (contextMenuAnchor && onTogglePin) {
    contextMenuItems.push({
      key: 'pin',
      title: t(pinned ? 'conversations.unpin' : 'conversations.pin'),
      icon: (
        <Pin
          size={CONTEXT_MENU_ICON_SIZE.pointer}
          color={c.text}
          fill={pinned ? c.text : 'transparent'}
        />
      ),
      onPress: () => onTogglePin(conversationKey, !!pinned),
    });
  }
  if (contextMenuAnchor) {
    contextMenuItems.push({
      key: 'mute',
      title: t(muted ? 'conversations.unmute' : 'conversations.mute'),
      icon: muted ? (
        <Bell size={CONTEXT_MENU_ICON_SIZE.pointer} color={c.text} />
      ) : (
        <BellOff size={CONTEXT_MENU_ICON_SIZE.pointer} color={c.text} />
      ),
      onPress: () => onToggleMute(conversationKey, muted),
    });
    contextMenuItems.push({
      key: 'delete',
      title: t('conversations.delete'),
      icon: <Trash2 size={CONTEXT_MENU_ICON_SIZE.pointer} color={c.danger} />,
      tone: 'danger',
      separatorBefore: true,
      onPress: () => {
        void platform.confirmationDialog
          .confirm({
            title: t('conversations.delete_title'),
            message: t('conversations.delete_message'),
            cancelLabel: t('common.cancel'),
            confirmLabel: t('conversations.delete'),
            destructive: true,
          })
          .then((confirmed) => {
            if (confirmed) onDelete(conversationKey);
          });
      },
    });
  }

  useEffect(() => {
    if (!highlighted) return;
    highlight.setValue(0.2);
    RNAnimated.timing(highlight, {
      toValue: 0,
      duration: 1500,
      useNativeDriver: Platform.OS !== 'web',
    }).start();
  }, [highlighted, highlightTick, highlight]);

  // An unsent composer draft replaces the last-message preview only after the
  // user leaves this conversation. In a wide layout the active row stays
  // mounted, so select `undefined` while active: keystrokes do not re-render the
  // row or expose the live composer text. Changing selection re-renders the row
  // and reads the latest draft once. Compact navigation unmounts the list while
  // chatting, then reads the draft when the inbox mounts again.
  const draft = useDraftsStore((s) =>
    active ? undefined : s.drafts[conversationKey],
  );
  const draftText = draft ? draft.replace(/\s+/g, ' ').trim() : '';

  // Leading (left→right) swipe: read/unread toggle then pin toggle. Each is
  // shown only where its handler is supplied (both are inbox-only). null when
  // neither applies, so the row has no left swipe.
  function renderLeftActions() {
    if (!onTogglePin && !onToggleUnread) return null;
    return (
      <View style={{ flexDirection: 'row' }}>
        {onToggleUnread ? (
          // Telegram-style chat-bubble glyph; a calm grey (not an alarm colour) —
          // marking unread is a quiet self-reminder, not a notification.
          <SwipeAction
            onPress={() => {
              closeSwipe();
              onToggleUnread(conversationKey, unreadCount);
            }}
            icon={
              unread ? (
                <MessageCircle size={20} color={c.textMuted} />
              ) : (
                <MessageCircleMore size={20} color={c.textMuted} />
              )
            }
            label={t(unread ? 'conversations.read' : 'conversations.unread')}
            color={c.textMuted}
            bgRest={c.textMuted + '22'}
          />
        ) : null}
        {onTogglePin ? (
          <SwipeAction
            onPress={() => {
              closeSwipe();
              onTogglePin(conversationKey, !!pinned);
            }}
            icon={
              <Pin
                size={20}
                color={c.accent}
                fill={pinned ? c.accent : 'transparent'}
              />
            }
            label={t(pinned ? 'conversations.unpin' : 'conversations.pin')}
            color={c.accent}
            bgRest={c.accent + '22'}
          />
        ) : null}
      </View>
    );
  }

  // Trailing (right→left) swipe: mute + delete, with delete's two-step confirm
  // animated as a growing red cell (see TrailingActions).
  function renderRightActions() {
    return (
      <TrailingActions
        confirming={confirmingDelete}
        muted={muted}
        muteLabel={t(muted ? 'conversations.unmute' : 'conversations.mute')}
        deleteLabel={t('conversations.delete')}
        confirmLabel={t('conversations.confirm_delete')}
        onToggleMute={() => {
          closeSwipe();
          onToggleMute(conversationKey, muted);
        }}
        onRequestConfirm={() => setConfirmingDelete(true)}
        onConfirmDelete={() => {
          closeSwipe();
          onDelete(conversationKey);
        }}
      />
    );
  }

  return (
    <Swipeable
      ref={swipeableRef}
      // RN Web has no native animated module; run the swipe on the JS
      // driver there so Animated stops warning about `useNativeDriver`.
      useNativeAnimations={Platform.OS !== 'web'}
      renderLeftActions={isRTL ? renderRightActions : renderLeftActions}
      renderRightActions={isRTL ? renderLeftActions : renderRightActions}
      leftThreshold={40}
      rightThreshold={40}
      friction={2}
      // Keep a left-edge strip free for the OS back-swipe: the leading (read /
      // pin) swipe is left→right like the navigator's pop gesture, so without
      // this guard a row would swallow the back-swipe. Negative `hitSlop`
      // shrinks the pan's active area off the edge (see BACK_SWIPE_GUARD).
      hitSlop={isRTL ? { right: -BACK_SWIPE_GUARD } : { left: -BACK_SWIPE_GUARD }}
      // Single-open coordination: opening this row closes whichever row was open
      // before, and the registry lets a tap elsewhere / a scroll dismiss it.
      onSwipeableWillOpen={() => registerOpenSwipeable(closeSwipe)}
      onSwipeableOpenStartDrag={() => {
        if (IS_ELECTRON) suppressDesktopSwipeReleaseRef.current = true;
      }}
      onSwipeableCloseStartDrag={() => {
        if (IS_ELECTRON) suppressDesktopSwipeReleaseRef.current = true;
      }}
      onSwipeableOpen={() => {
        suppressDesktopSwipeReleaseRef.current = false;
      }}
      // Sliding the row back (or any close) cancels a pending delete-confirm and
      // drops this row from the registry (iff it's the tracked one).
      onSwipeableClose={() => {
        clearOpenSwipeable(closeSwipe);
        setConfirmingDelete(false);
        suppressDesktopSwipeReleaseRef.current = false;
      }}
    >
      <DesktopPressable
        ref={fileDropTargetRef}
        fallbackHoverOpacity={false}
        pressFeedback="immediate"
        onContextMenu={IS_ELECTRON ? handleContextMenu : undefined}
        // Visible-row warming already owns database I/O. Starting a cold read
        // under the finger cannot reliably finish before release and can return
        // decoding work exactly when navigation needs the JS thread.
        onPressIn={() => {
          beginChatOpenTrace(conversationKey);
        }}
        onPress={() => {
          // React Native Web can still dispatch a click when a mouse drag ends.
          // Consume that release so it cannot immediately close the menu that
          // Swipeable just opened or navigate the row.
          if (suppressDesktopSwipeReleaseRef.current) {
            suppressDesktopSwipeReleaseRef.current = false;
            return;
          }
          // Tapping the row whose own menu is open just dismisses it (swallowed).
          // Tapping a *different* row closes that open menu but still opens this
          // chat — so a tap elsewhere both snaps the old menu shut and navigates.
          if (closeIfOpen(closeSwipe)) return;
          closeOpenSwipeable();
          if (openingRef.current) return;
          openingRef.current = true;
          // Block only a second release in this frame. The inbox screen remains
          // mounted underneath the pushed route, so retaining this lock until
          // unmount would make the row permanently inert after navigating back.
          openingResetFrameRef.current = requestAnimationFrame(() => {
            openingRef.current = false;
            openingResetFrameRef.current = null;
          });
          // Route immediately on release. A cache miss never sits between the
          // user's tap and the native stack transition.
          markChatNavigation(conversationKey);
          onPress(conversationKey, identityKind, conversationName);
        }}
        accessibilityState={{ selected: active }}
        style={{
          height: uiDensity.conversationRowHeight,
          paddingHorizontal: 16,
          flexDirection: 'row',
          alignItems: 'center',
          gap: 12,
          overflow: 'hidden',
          // A pinned row gets a white `surface` fill so it floats off the grey
          // page (iOS grouped-card look) while pinned at the top. Keep the base
          // opaque as it slides over swipe actions; active selection is a
          // separate neutral wash below the content so action colours cannot
          // bleed through it.
          backgroundColor: pinned ? c.surface : c.background,
        }}
      >
        {(state) => {
          const hovered = isInteractiveHovered(state);
          const selectedOrPressed = active || (showPressedFill && state.pressed);
          const wideHover =
            !active && ((!showPressedFill && hovered) || fileDragActive);
          return (
            <>
              {selectedOrPressed || wideHover ? <InteractionOverlay /> : null}
              <Avatar
                pubkey={counterpartyPubkey ?? '0'.repeat(64)}
                picture={conversationPicture ?? profile?.picture}
                name={displayName}
                size={uiDensity.conversationAvatarSize}
              />
              <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
                {/* Top line: name (with its leading You/Blocked marker — mutually
                    exclusive, so they read consistently with the contacts list) and the
                    right-aligned timestamp. */}
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
                  <View
                    style={{
                      flex: 1,
                      minWidth: 0,
                      flexDirection: 'row',
                      alignItems: 'center',
                      gap: spacing.sm,
                    }}
                  >
                    {isSelf ? <SelfBadge /> : blocked ? <BlockedBadge /> : null}
                    {identityKind === 'proximity' ? (
                      <NearbyBadge status={proximityConnectionStatus} />
                    ) : null}
                    <AppText
                      variant="subtitle"
                      numberOfLines={1}
                      style={{ flexShrink: 1, minWidth: 0 }}
                    >
                      {displayName}
                    </AppText>
                    {muted ? (
                      <BellOffBold
                        size={uiDensity.conversationStatusIconSize}
                        color={c.textMuted}
                        style={{ flexShrink: 0 }}
                      />
                    ) : null}
                  </View>
                  <AppText
                    variant="caption"
                    tone="subtle"
                    weight="regular"
                    numberOfLines={1}
                    style={{ flexShrink: 0 }}
                  >
                    {formatListTime(lastMessageAt)}
                  </AppText>
                </View>
                {/* Bottom line: the message preview takes the full width, with the
                    unread count tucked to its right *only when there is one* — so a row
                    with no badge uses the whole line. Muted shows the calm `neutral`
                    count (not red, and not summed into the tab badge); unmuted shows
                    the notification-red count. */}
                <View
                  style={{
                    minHeight: typography.body.lineHeight,
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: 8,
                  }}
                >
                  {draftText ? (
                    <AppText variant="body" tone="muted" numberOfLines={1} style={{ flex: 1 }}>
                      <>
                        <AppText variant="body" tone="danger" weight="medium">
                          {t('conversations.draft')}{' '}
                        </AppText>
                        {draftText}
                      </>
                    </AppText>
                  ) : (
                    <MessagePreviewText
                      content={lastMessagePreview ?? ''}
                      tags={lastMessageTags}
                      invoiceRole={lastMessageFromSelf ? 'sent' : 'received'}
                    />
                  )}
                  {unreadCount > 0 ? (
                    <CountBadge
                      count={unreadCount}
                      tone={muted ? 'neutral' : 'notification'}
                      size="sm"
                    />
                  ) : null}
                </View>
              </View>
              <RNAnimated.View
                style={[
                  StyleSheet.absoluteFill,
                  {
                    backgroundColor: c.text,
                    opacity: highlight,
                  },
                  { pointerEvents: 'none' },
                ]}
              />
            </>
          );
        }}
      </DesktopPressable>
      {contextMenuAnchor ? (
        <ContextMenu
          anchor={contextMenuAnchor}
          items={contextMenuItems}
          onClose={closeContextMenu}
        />
      ) : null}
    </Swipeable>
  );
}

/** FlatList rechecks every mounted row when its selection `extraData` changes.
 * Shallow prop equality stops that check at the row boundary, so only the old
 * and new selected rows render; hooks inside all other visible rows stay idle. */
export const ConversationListItem = memo(ConversationListItemBase);
