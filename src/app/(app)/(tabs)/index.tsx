import { useIsFocused, useNavigation } from 'expo-router';
import { ChatRound as MessageCircle } from '@solar-icons/react-native/category/messages/Linear/ChatRound';
import Plus from 'lucide-react-native/icons/plus';
import { Scanner } from '@solar-icons/react-native/category/security/Linear/Scanner';
import { Radar } from '@solar-icons/react-native/category/map/Linear/Radar';
import { Radar2 } from '@solar-icons/react-native/category/map/Linear/Radar2';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FlatList, Keyboard, StyleSheet, View, type ViewToken } from 'react-native';

import { InteractivePressable as Pressable } from '@/components/common/InteractivePressable';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppScreen } from '@/components/common/AppScreen';
import { AppText } from '@/components/common/AppText';
import {
  HEADER_ACTION_MENU_ICON_SIZE,
  HeaderActionMenu,
  type HeaderActionMenuAnchor,
} from '@/components/common/HeaderActionMenu';
import { IconButton } from '@/components/common/IconButton';
import { QrScanButton, type QrScanButtonHandle } from '@/components/common/QrScanButton';
import { ScreenHeader } from '@/components/common/ScreenHeader';
import { ConversationListItem } from '@/components/conversation/ConversationListItem';
import { ScreenshotConversations } from '@/components/marketing/ScreenshotConversations';
import { usePrimaryPaneNavigation } from '@/components/navigation/primary-pane-navigation';
import { GlobalSearch } from '@/components/search/GlobalSearch';
import { loadChatPageRuntime } from '@/components/chat/chat-page-runtime-loader';
import { SearchBar, SEARCH_BAR_SCREEN_GUTTER } from '@/components/search/SearchBar';
import { SEARCH_ACTIVATION_SHORTCUT_LABEL } from '@/components/search/search-shortcut';
import { useMainInboxConversations, type ConversationWithLast } from '@/hooks/use-conversations';
import { scheduleMessageTailWarm } from '@/services/conversation/message-tail-cache';
import { useProfile } from '@/hooks/use-profile';
import { useScrolled } from '@/hooks/use-scrolled';
import { useWidePaneSelection } from '@/hooks/use-wide-pane-selection';
import { closeOpenSwipeable } from '@/lib/gestures';
import type { ComposerFile } from '@/lib/attachments/composer-file';
import { attachmentLabel } from '@/lib/nostr/attachment-label';
import { resolveChatQrScan } from '@/lib/scan/chat-qr';
import { IS_ELECTRON } from '@/lib/platform';
import { platform } from '@/platform';
import {
  setConversationMuted,
  setConversationPinned,
} from '@/services/conversation/conversation-prefs.service';
import { dmService } from '@/services/dm/dm.service';
import { getProximityEnabled } from '@/services/proximity/proximity-preferences';
import { syncPersonalConfigs } from '@/services/relay/personal-configs.service';
import { getDefaultWallet } from '@/services/wallet/wallet.service';
import { useActiveAccount } from '@/stores/active-account.store';
import { useComposerFileHandoffStore } from '@/stores/composer-file-handoff.store';
import { useProximityStore } from '@/stores/proximity.store';
import { useSyncPhase } from '@/stores/sync-status.store';
import { useScreenshotPreviewStore } from '@/stores/screenshot-preview.store';
import { iconStrokeWidth } from '@/theme/icons';
import { bottomBarHeight, headerHeight, spacing, uiDensity, useThemeColors } from '@/theme';

// Height below the screen header occupied by the search bar and its bottom inset.
const SEARCH_HEADER_BODY_HEIGHT = uiDensity.searchBarHeight + spacing.sm;
// ConversationListItem uses a fixed runtime row height — used with the measured viewport to
// size the tap-to-dismiss footer below the rows.
const CONV_ROW_HEIGHT = uiDensity.conversationRowHeight;
const CONVERSATION_VIEWABILITY_CONFIG = {
  itemVisiblePercentThreshold: 1,
} as const;

export default function Conversations() {
  const screenshotPreviewEnabled = useScreenshotPreviewStore((state) => state.enabled);
  return screenshotPreviewEnabled ? <ScreenshotConversations /> : <RealConversations />;
}

function RealConversations() {
  const { t } = useTranslation();
  const c = useThemeColors();
  const insets = useSafeAreaInsets();
  const bottomClearance = bottomBarHeight + insets.bottom;
  const topClearance = headerHeight + insets.top;
  const searchHeaderHeight = topClearance + SEARCH_HEADER_BODY_HEIGHT;
  const accountPubkey = useActiveAccount((s) => s.activePubkey);
  // Conversation rows already warm each visible peer. Keep our own profile in
  // the same session cache so transition reply previews authored by us also
  // have their final name without doing navigation-time SQLite work.
  useProfile(accountPubkey);
  const proximityEnabled = useProximityStore(
    (state) => (accountPubkey != null && state.featureEnabledByAccount[accountPubkey]) === true,
  );
  const { conversations: items, loaded } = useMainInboxConversations(accountPubkey ?? '');
  const { conversationKey: activeConversationKey } = useWidePaneSelection();
  const { open: openInDetailPane, wide } = usePrimaryPaneNavigation();
  const startComposerFileHandoff = useComposerFileHandoffStore((state) => state.start);
  // `FlatList` requires this callback identity to stay stable for the lifetime
  // of the list. Read the active account only when viewability changes, then
  // warm as soon as even 1% of a row enters from either edge.
  const [handleVisibleConversationsChanged] = useState(
    () =>
      ({ viewableItems }: { viewableItems: ViewToken<ConversationWithLast>[] }) => {
        const activeAccountPubkey = useActiveAccount.getState().activePubkey ?? '';
        if (!activeAccountPubkey) return;
        for (const token of viewableItems) {
          if (!token.isViewable) continue;
          const conversation = token.item.conversation;
          scheduleMessageTailWarm(activeAccountPubkey, conversation.conversationKey);
        }
      },
  );
  const syncPhase = useSyncPhase();
  // Header gains a bottom hairline once the inbox scrolls under it.
  const { scrolled, scrollProps } = useScrolled();
  const listRef = useRef<FlatList<ConversationWithLast>>(null);
  // Measured viewport height of the list — sizes the footer so its blank area
  // (below the rows) fills the screen and stays tappable to dismiss an open
  // swipe menu on a short inbox.
  const [listH, setListH] = useState(0);
  const [highlightedKey, setHighlightedKey] = useState<string | null>(null);
  const [highlightTick, setHighlightTick] = useState(0);
  const highlightTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!accountPubkey) return;
    void getProximityEnabled(accountPubkey).catch(() => {});
  }, [accountPubkey]);
  const qrScanRef = useRef<QrScanButtonHandle>(null);
  const headerActionRef = useRef<View>(null);
  // Search mode: when active the inbox is hidden and GlobalSearch's results
  // cover it. `query` lives inside GlobalSearch, so typing never re-renders the
  // inbox — only this flag (toggled on focus/cancel) does.
  const [searchActive, setSearchActive] = useState(false);
  const openSearch = useCallback(() => setSearchActive(true), []);
  const closeSearch = useCallback(() => {
    setSearchActive(false);
    Keyboard.dismiss();
  }, []);
  const [headerMenuOpen, setHeaderMenuOpen] = useState(false);
  const [headerMenuAnchor, setHeaderMenuAnchor] = useState<HeaderActionMenuAnchor | null>(null);
  const attachmentLabels = useMemo(
    () => ({
      file: t('conversations.attachment_file_preview'),
      image: t('conversations.attachment_image_preview'),
      video: t('conversations.attachment_video_preview'),
      voice: t('conversations.attachment_voice_preview'),
    }),
    [t],
  );
  // Cursor into the unread conversations: each Chats-tab re-press advances to
  // the next unread; it resets to the first whenever the tab regains focus.
  const unreadCursor = useRef(0);
  const focused = useIsFocused();
  const navigation = useNavigation();

  // Native production bundles already contain the route bytecode, but module
  // evaluation still walks the chat runtime's large dependency graph. Pay that
  // cost while the inbox is idle so a row release only renders the destination.
  // Scheduled once with no cancel: `items.length` churn during the initial sync
  // must not keep re-queueing the idle callback, and the timeout bounds how long
  // a busy JS thread (e.g. gift-wrap decryption) may defer it — otherwise the
  // first tap pays the whole evaluation synchronously. Firing after unmount is
  // harmless (a memoized module import, no state update).
  const chatRuntimePreloadRef = useRef(false);
  useEffect(() => {
    if (chatRuntimePreloadRef.current || items.length === 0) return;
    chatRuntimePreloadRef.current = true;
    requestIdleCallback(
      () => {
        void loadChatPageRuntime();
      },
      { timeout: 2000 },
    );
  }, [items.length]);

  const openConversation = useCallback(
    (
      conversationKey: string,
      deliveryKind: ConversationWithLast['conversation']['deliveryKind'],
      name: string | null,
    ) => {
      const href =
        deliveryKind === 'proximity'
          ? `/chat/${encodeURIComponent(conversationKey)}?transport=proximity&name=${encodeURIComponent(name ?? '')}`
          : `/chat/${encodeURIComponent(conversationKey)}`;
      openInDetailPane(href);
    },
    [openInDetailPane],
  );

  const dropFilesIntoConversation = useCallback(
    (
      conversationKey: string,
      deliveryKind: ConversationWithLast['conversation']['deliveryKind'],
      name: string | null,
      files: ComposerFile[],
    ) => {
      if (!accountPubkey || files.length === 0) return;
      startComposerFileHandoff({ accountPubkey, conversationKey, files });
      openConversation(conversationKey, deliveryKind, name);
    },
    [accountPubkey, openConversation, startComposerFileHandoff],
  );

  const toggleConversationMute = useCallback(
    (conversationKey: string, muted: boolean) => {
      if (!accountPubkey) return;
      void setConversationMuted(accountPubkey, conversationKey, !muted);
    },
    [accountPubkey],
  );

  const toggleConversationPin = useCallback(
    (conversationKey: string, pinned: boolean) => {
      if (!accountPubkey) return;
      void setConversationPinned(accountPubkey, conversationKey, !pinned);
    },
    [accountPubkey],
  );

  const toggleConversationUnread = useCallback(
    (conversationKey: string, unreadCount: number) => {
      if (!accountPubkey) return;
      void (unreadCount > 0
        ? dmService.markConversationAsRead(accountPubkey, conversationKey)
        : dmService.markConversationAsUnread(accountPubkey, conversationKey));
    },
    [accountPubkey],
  );

  const deleteConversation = useCallback(
    (conversationKey: string) => {
      if (!accountPubkey) return;
      void dmService.deleteConversation(accountPubkey, conversationKey);
    },
    [accountPubkey],
  );

  // Pull cross-device personal configs set on other devices so they land here:
  // the private mute/contact/block NIP-51 sets (pinned is device-local, not
  // synced), the public media-server list (kind 10063), and the preferred-emoji
  // list (kind 10030). One cache-first, TTL-gated call — a fully fresh cache
  // costs zero network, and a miss leaves local state untouched. Contacts
  // syncing also graduates contacts' threads out of Requests — on a fresh login
  // history backfills before contacts sync, so without this their conversations
  // would sit in Requests until the user opened the Contacts tab.
  useEffect(() => {
    if (!accountPubkey) return;
    void syncPersonalConfigs(accountPubkey).catch(() => {});
  }, [accountPubkey]);

  // Re-pressing the Chats tab while already here walks through unread
  // conversations. When none remain, it matches the other tabs by returning
  // the inbox to the top.
  useEffect(() => {
    const onTabPress = navigation.addListener('tabPress' as never, () => {
      // In the wide layout a pushed detail page keeps stack focus while this
      // pane stays visible, so `isFocused()` is false exactly when the
      // re-press walk should still work. Gate on the tab selection instead:
      // the walk only runs when Chats is already the selected tab.
      const tabState = navigation.getState();
      const selectedTab = tabState?.index != null ? tabState.routes[tabState.index] : undefined;
      if (selectedTab?.name !== 'index') return;
      // Re-pressing the active tab dismisses search before any inbox-specific
      // unread walk or scroll-to-top behavior runs.
      if (searchActive) {
        closeSearch();
        return;
      }
      // Global indices of unread (non-muted) conversations, in list order.
      const unreadIdxs = items.reduce<number[]>((acc, it, i) => {
        if (it.conversation.unreadCount > 0 && !it.conversation.muted) acc.push(i);
        return acc;
      }, []);
      if (unreadIdxs.length === 0) {
        listRef.current?.scrollToOffset({ offset: 0, animated: true });
        return;
      }
      const cursor = unreadCursor.current % unreadIdxs.length;
      const targetIdx = unreadIdxs[cursor];
      unreadCursor.current = cursor + 1; // next press → next unread (wraps)
      listRef.current?.scrollToIndex({
        index: targetIdx,
        animated: true,
        viewPosition: 0,
        viewOffset: topClearance,
      });
      const key = items[targetIdx].conversation.conversationKey;
      setHighlightedKey(key);
      setHighlightTick((tick) => tick + 1);
      if (highlightTimer.current) clearTimeout(highlightTimer.current);
      highlightTimer.current = setTimeout(
        () => setHighlightedKey((k) => (k === key ? null : k)),
        1600,
      );
    });
    // Re-entering the Chats tab restarts the walk from the first unread.
    const onFocus = navigation.addListener('focus', () => {
      unreadCursor.current = 0;
    });
    return () => {
      onTabPress();
      onFocus();
    };
  }, [navigation, items, searchActive, closeSearch, topClearance]);

  useEffect(
    () => () => {
      if (highlightTimer.current) clearTimeout(highlightTimer.current);
    },
    [],
  );

  async function handleQrScanned(data: string) {
    const result = await resolveChatQrScan(data);
    if (result.kind === 'invalid') {
      await platform.confirmationDialog.notify({
        title: t('scan.invalid'),
        okLabel: t('common.ok'),
      });
      return;
    }

    setSearchActive(false);
    if (result.kind === 'chat') {
      openInDetailPane(`/profile/${encodeURIComponent(result.pubkey)}`);
      return;
    }

    if (!accountPubkey || !(await getDefaultWallet(accountPubkey))) {
      openInDetailPane('/wallet');
      return;
    }
    openInDetailPane(`/wallet-send?input=${encodeURIComponent(result.input)}`);
  }

  function toggleHeaderMenu() {
    if (headerMenuOpen) {
      setHeaderMenuOpen(false);
      return;
    }
    headerActionRef.current?.measureInWindow((x, y, width, height) => {
      // Electron drops the menu below the trigger like a desktop menubar;
      // touch keeps the trigger's top-end corner alignment.
      setHeaderMenuAnchor({
        x: x + width,
        y: IS_ELECTRON ? y + height + spacing.xs : y,
      });
      setHeaderMenuOpen(true);
    });
  }

  return (
    <AppScreen edges={[]}>
      <HeaderActionMenu
        visible={headerMenuOpen}
        anchor={headerMenuAnchor}
        onClose={() => setHeaderMenuOpen(false)}
        items={[
          {
            key: 'new-chat',
            icon: <MessageCircle size={HEADER_ACTION_MENU_ICON_SIZE} color={c.text} />,
            title: t('conversations.new_chat_action'),
            onPress: () => openInDetailPane('/new-chat'),
          },
          {
            key: 'scan',
            icon: <Scanner size={HEADER_ACTION_MENU_ICON_SIZE} color={c.text} />,
            title: t('conversations.scan_action'),
            onPress: () => void qrScanRef.current?.open(),
          },
        ]}
      />

      <GlobalSearch
        accountPubkey={accountPubkey ?? ''}
        active={searchActive}
        focused={focused}
        onActivate={openSearch}
        onClose={closeSearch}
      >
        {/* A warm inbox can render immediately, but an empty cold read must resolve
          before the empty state is trustworthy. */}
        {!loaded && items.length === 0 ? (
          <View style={{ flex: 1 }} />
        ) : items.length === 0 ? (
          <View
            style={{
              flex: 1,
              alignItems: 'center',
              justifyContent: 'center',
              gap: 12,
              padding: 24,
              paddingTop: topClearance,
            }}
          >
            <MessageCircle size={40} color={c.textMuted} />
            <AppText variant="subtitle" tone="muted" align="center" weight="semibold">
              {t('conversations.empty_title')}
            </AppText>
            <AppText variant="body" tone="subtle" align="center" style={{ maxWidth: 280 }}>
              {t('conversations.empty_hint')}
            </AppText>
          </View>
        ) : (
          <View
            style={{ flex: 1 }}
            onLayout={(e) => {
              const h = e.nativeEvent.layout.height;
              if (h > 0) setListH(h);
            }}
          >
            <FlatList
              ref={listRef}
              data={items}
              extraData={activeConversationKey}
              // Fixed-height rows (+ a hairline separator) after the search
              // header, so we hand FlatList the geometry directly: no per-row
              // measurement, and scrollToIndex (jump-to-unread) lands exactly.
              getItemLayout={(_, index) => ({
                length: CONV_ROW_HEIGHT,
                offset:
                  searchHeaderHeight +
                  (CONV_ROW_HEIGHT + StyleSheet.hairlineWidth) * index,
                index,
              })}
              onScrollToIndexFailed={({ index }) =>
                listRef.current?.scrollToOffset({
                  offset:
                    searchHeaderHeight +
                    (CONV_ROW_HEIGHT + StyleSheet.hairlineWidth) * index -
                    topClearance,
                  animated: true,
                })
              }
              // Drives the header's bottom hairline (border once scrolled off top).
              {...scrollProps}
              viewabilityConfig={CONVERSATION_VIEWABILITY_CONFIG}
              onViewableItemsChanged={handleVisibleConversationsChanged}
              contentContainerStyle={{ paddingBottom: bottomClearance }}
              keyboardDismissMode="on-drag"
              // A swipe menu is dismissed the moment you scroll the list (tapping a
              // row or the blank footer below dismisses it too — see the row's
              // onPress and the footer Pressable). An empty focused search also
              // yields focus as soon as the resting inbox starts scrolling.
              onScrollBeginDrag={() => {
                Keyboard.dismiss();
                closeOpenSwipeable();
              }}
              // Inactive search affordance at the top of the list (visible at rest);
              // it's a button — tapping opens the real (autofocused) search.
              ListHeaderComponent={
                <View
                  style={{
                    paddingHorizontal: SEARCH_BAR_SCREEN_GUTTER,
                    paddingTop: topClearance,
                    paddingBottom: spacing.sm,
                  }}
                >
                  <SearchBar
                    value=""
                    onChangeText={() => {}}
                    shortcutHint={SEARCH_ACTIVATION_SHORTCUT_LABEL}
                    onPress={openSearch}
                  />
                </View>
              }
              // Footer fills the blank below the rows (viewport − search header −
              // rows) so tapping there dismisses an open swipe menu; 0 on a full
              // inbox. (No-op when no menu is open.)
              ListFooterComponent={
                <Pressable
                  onPress={() => closeOpenSwipeable()}
                  accessible={false}
                  style={{
                    height: Math.max(
                      0,
                      listH -
                        searchHeaderHeight -
                        bottomClearance -
                        items.length * CONV_ROW_HEIGHT,
                    ),
                  }}
                />
              }
              ItemSeparatorComponent={() => (
                // Hairline between rows, inset past the avatar (paddingHorizontal 16
                // + avatar 44 + gap 12 = 72) so it aligns with the text, iOS-style.
                <View
                  style={{
                    height: StyleSheet.hairlineWidth,
                    marginStart: 72,
                    backgroundColor: c.border,
                  }}
                />
              )}
              keyExtractor={(item) =>
                `${item.conversation.accountPubkey}:${item.conversation.conversationKey}`
              }
              renderItem={({ item }) => {
                const conv = item.conversation;
                return (
                  <ConversationListItem
                    conversationKey={conv.conversationKey}
                    counterpartyPubkey={conv.conversationKey}
                    conversationName={conv.name}
                    lastMessagePreview={
                      item.lastMessageKind === 15
                        ? attachmentLabel(item.lastMessageTags, attachmentLabels)
                        : item.lastMessageContent
                    }
                    lastMessageTags={item.lastMessageTags}
                    lastMessageFromSelf={
                      conv.deliveryKind === 'proximity'
                        ? item.lastMessageSenderPubkey !== conv.conversationKey
                        : item.lastMessageSenderPubkey === accountPubkey
                    }
                    lastMessageAt={conv.lastMessageAt}
                    unreadCount={conv.unreadCount}
                    muted={conv.muted}
                    identityKind={conv.deliveryKind}
                    pinned={conv.pinned}
                    highlighted={conv.conversationKey === highlightedKey}
                    highlightTick={conv.conversationKey === highlightedKey ? highlightTick : 0}
                    active={conv.conversationKey === activeConversationKey}
                    showPressedFill={!wide}
                    onPress={openConversation}
                    onDropFiles={dropFilesIntoConversation}
                    onToggleMute={toggleConversationMute}
                    onTogglePin={toggleConversationPin}
                    onToggleUnread={toggleConversationUnread}
                    onDelete={deleteConversation}
                  />
                );
              }}
            />
          </View>
        )}
      </GlobalSearch>
      {/* Render after the dynamic list so BlurView samples its live content. */}
      <ScreenHeader
        back={false}
        bordered={scrolled}
        title={
          syncPhase === 'connecting'
            ? t('sync.connecting')
            : syncPhase === 'syncing'
              ? t('sync.loading')
              : t('tabs.conversations')
        }
        left={
          <IconButton
            variant="plain"
            size={uiDensity.headerActionSize}
            onPress={() => openInDetailPane('/nearby')}
            hitSlop={10}
            icon={
              proximityEnabled ? (
                <Radar2 size={uiDensity.headerActionIconSize} color={c.text} />
              ) : (
                <Radar size={uiDensity.headerActionIconSize} color={c.text} />
              )
            }
            accessibilityLabel={t('conversations.nearby_action')}
          />
        }
        right={
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            <QrScanButton
              ref={qrScanRef}
              onScanned={(data) => void handleQrScanned(data)}
              showTrigger={false}
            />
            <View ref={headerActionRef} collapsable={false}>
              <IconButton
                variant="plain"
                size={uiDensity.headerActionSize}
                onPress={toggleHeaderMenu}
                hitSlop={10}
                icon={<Plus strokeWidth={iconStrokeWidth.default} size={uiDensity.headerActionIconSize} color={c.text} />}
                accessibilityLabel={t('conversations.actions')}
              />
            </View>
          </View>
        }
      />
    </AppScreen>
  );
}
