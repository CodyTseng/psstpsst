import { Radar } from '@solar-icons/react-native/category/map/Linear/Radar';
import Plus from 'lucide-react-native/icons/plus';
import { useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { FlatList, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppScreen } from '@/components/common/AppScreen';
import { IconButton } from '@/components/common/IconButton';
import { ScreenHeader } from '@/components/common/ScreenHeader';
import { ConversationListItem } from '@/components/conversation/ConversationListItem';
import { usePrimaryPaneNavigation } from '@/components/navigation/primary-pane-navigation';
import { SearchBar, SEARCH_BAR_SCREEN_GUTTER } from '@/components/search/SearchBar';
import { SEARCH_ACTIVATION_SHORTCUT_LABEL } from '@/components/search/search-shortcut';
import { useScrolled } from '@/hooks/use-scrolled';
import { useWidePaneSelection } from '@/hooks/use-wide-pane-selection';
import { iconStrokeWidth } from '@/theme/icons';
import { bottomBarHeight, headerHeight, spacing, uiDensity, useThemeColors } from '@/theme';
import { useScreenshotPreviewStore } from '@/stores/screenshot-preview.store';

import {
  buildScreenshotConversations,
  type ScreenshotConversation,
} from './screenshot-preview-data';

export function ScreenshotConversations() {
  const { t } = useTranslation();
  const c = useThemeColors();
  const insets = useSafeAreaInsets();
  const { open, wide } = usePrimaryPaneNavigation();
  const { conversationKey } = useWidePaneSelection();
  const { scrolled, scrollProps } = useScrolled();
  const markConversationRead = useScreenshotPreviewStore((state) => state.markConversationRead);
  const readConversationIds = useScreenshotPreviewStore((state) => state.readConversationIds);
  const timelineAnchorMs = useScreenshotPreviewStore((state) => state.timelineAnchorMs);
  const conversations = useMemo(
    () => buildScreenshotConversations(timelineAnchorMs),
    [timelineAnchorMs],
  );
  const topClearance = headerHeight + insets.top;
  const bottomClearance = bottomBarHeight + insets.bottom;
  const openConversation = useCallback(
    (item: ScreenshotConversation) => {
      markConversationRead(item.id, item.unread);
      open(`/chat/${item.pubkey}?preview=${item.id}`);
    },
    [markConversationRead, open],
  );

  return (
    <AppScreen edges={[]}>
      <FlatList
        data={conversations}
        keyExtractor={(item) => item.id}
        contentContainerStyle={{ paddingBottom: bottomClearance }}
        {...scrollProps}
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
              onPress={() => {}}
            />
          </View>
        }
        ItemSeparatorComponent={() => (
          <View
            style={{
              height: StyleSheet.hairlineWidth,
              marginStart: spacing['3xl'] + spacing.xl,
              backgroundColor: c.border,
            }}
          />
        )}
        renderItem={({ item }) => (
          <ConversationListItem
            conversationKey={item.pubkey}
            counterpartyPubkey={item.pubkey}
            conversationName={item.name}
            conversationPicture={item.picture}
            lastMessagePreview={item.preview}
            lastMessageAt={item.lastMessageAt}
            unreadCount={readConversationIds[item.id] ? 0 : item.unread}
            muted={false}
            active={wide && conversationKey === item.pubkey}
            showPressedFill={!wide}
            liveDataEnabled={false}
            onPress={() => openConversation(item)}
            onToggleMute={NOOP}
            onDelete={NOOP}
          />
        )}
      />
      <ScreenHeader
        back={false}
        bordered={scrolled}
        title={t('tabs.conversations')}
        left={
          <IconButton
            variant="plain"
            size={uiDensity.headerActionSize}
            onPress={() => {}}
            icon={<Radar size={uiDensity.headerActionIconSize} color={c.text} />}
            accessibilityLabel={t('conversations.nearby_action')}
          />
        }
        right={
          <IconButton
            variant="plain"
            size={uiDensity.headerActionSize}
            onPress={() => {}}
            icon={
              <Plus
                size={uiDensity.headerActionIconSize}
                strokeWidth={iconStrokeWidth.default}
                color={c.text}
              />
            }
            accessibilityLabel={t('conversations.actions')}
          />
        }
      />
    </AppScreen>
  );
}

const NOOP = () => {};
