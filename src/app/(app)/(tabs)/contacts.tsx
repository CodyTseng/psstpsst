import { useIsFocused, useNavigation } from 'expo-router';
import { UserPlus } from '@solar-icons/react-native/category/users/Linear/UserPlus';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FlatList, Keyboard, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppScreen } from '@/components/common/AppScreen';
import { AppText } from '@/components/common/AppText';
import { IconButton } from '@/components/common/IconButton';
import { NotificationDot } from '@/components/common/NotificationDot';
import { ScreenHeader } from '@/components/common/ScreenHeader';
import { usePrimaryPaneNavigation } from '@/components/navigation/primary-pane-navigation';
import {
  ContactSectionList,
  type ContactSectionListHandle,
} from '@/components/contacts/ContactSectionList';
import { ContactListItem } from '@/components/conversation/ContactListItem';
import { SearchBar, SEARCH_BAR_SCREEN_GUTTER } from '@/components/search/SearchBar';
import { SearchTransition } from '@/components/search/SearchTransition';
import { SEARCH_ACTIVATION_SHORTCUT_LABEL } from '@/components/search/search-shortcut';
import { useContactEntries } from '@/hooks/use-contact-entries';
import { useUnreadRequestCount } from '@/hooks/use-conversations';
import { useScrolled } from '@/hooks/use-scrolled';
import { syncPersonalConfigs } from '@/services/relay/personal-configs.service';
import { useActiveAccount } from '@/stores/active-account.store';
import { bottomBarHeight, headerHeight, spacing, uiDensity, useThemeColors } from '@/theme';

export default function Contacts() {
  const { t } = useTranslation();
  const c = useThemeColors();
  const insets = useSafeAreaInsets();
  const bottomClearance = bottomBarHeight + insets.bottom + spacing.lg;
  const topClearance = headerHeight + insets.top;
  const accountPubkey = useActiveAccount((s) => s.activePubkey);
  const { entries, loaded } = useContactEntries(accountPubkey);
  const unreadRequestCount = useUnreadRequestCount(accountPubkey ?? '');
  const focused = useIsFocused();
  const navigation = useNavigation();
  const groupedListRef = useRef<ContactSectionListHandle>(null);
  const { open: openInDetailPane } = usePrimaryPaneNavigation();

  // Pull the personal config batch on mount so contacts added on other devices
  // appear here (TTL-gated, so a fresh cache costs zero network). Best-effort —
  // failures leave the local list untouched.
  useEffect(() => {
    if (!accountPubkey) return;
    void syncPersonalConfigs(accountPubkey).catch(() => {});
  }, [accountPubkey]);

  // Live search filter (by resolved name / published username). Null when the
  // box is empty — the grouped localized index shows instead.
  const [query, setQuery] = useState('');
  // Search mode mounts the editable bar; results replace the grouped list only
  // after the query contains searchable text.
  const [searchActive, setSearchActive] = useState(false);
  const openSearch = useCallback(() => setSearchActive(true), []);
  const exitSearch = useCallback(() => {
    setQuery('');
    setSearchActive(false);
    Keyboard.dismiss();
  }, []);
  // Header gains a bottom hairline once the list scrolls under it.
  const { scrolled, scrollProps } = useScrolled();
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return null;
    return entries.filter(
      (e) =>
        e.displayName.toLowerCase().includes(q) ||
        (e.secondaryName?.toLowerCase().includes(q) ?? false),
    );
  }, [query, entries]);

  useEffect(() => {
    const onTabPress = navigation.addListener('tabPress' as never, () => {
      // The press that switches into this tab also fires `tabPress`; only a
      // re-press of the already-selected tab scrolls to top.
      const tabState = navigation.getState();
      const selectedTab = tabState?.index != null ? tabState.routes[tabState.index] : undefined;
      if (selectedTab?.name !== 'contacts') return;
      if (searchActive) {
        exitSearch();
        return;
      }
      groupedListRef.current?.scrollToTop(true);
    });
    return onTabPress;
  }, [navigation, searchActive, exitSearch]);

  function openChat(pubkey: string) {
    if (!accountPubkey) return;
    // conversation_key is just the counterparty pubkey.
    openInDetailPane(`/chat/${encodeURIComponent(pubkey)}`);
  }

  return (
    <AppScreen edges={[]}>
      <SearchTransition
        active={searchActive}
        contentActive={filtered !== null}
        focused={focused}
        onActivate={openSearch}
        onCancel={exitSearch}
        activeChrome={
          <View
            style={{
              paddingHorizontal: SEARCH_BAR_SCREEN_GUTTER,
              paddingTop: topClearance,
              paddingBottom: spacing.sm,
            }}
          >
            <SearchBar
              value={query}
              onChangeText={setQuery}
              placeholder={t('search.contacts_placeholder')}
              shortcutHint={SEARCH_ACTIVATION_SHORTCUT_LABEL}
              autoFocus
            />
          </View>
        }
        activeContent={
          <View
            style={{
              flex: 1,
              paddingTop: topClearance + uiDensity.searchBarHeight + spacing.sm,
            }}
          >
            <FlatList
              data={filtered ?? entries}
              keyboardShouldPersistTaps="handled"
              keyboardDismissMode="on-drag"
              keyExtractor={(item) => item.pubkey}
              renderItem={({ item }) => (
                <ContactListItem
                  counterpartyPubkey={item.pubkey}
                  displayName={item.displayName}
                  secondaryName={item.secondaryName}
                  picture={item.picture}
                  onPress={() => openChat(item.pubkey)}
                />
              )}
              ListEmptyComponent={
                <View style={{ paddingTop: 48, alignItems: 'center' }}>
                  <AppText variant="body" tone="muted">
                    {t('search.empty')}
                  </AppText>
                </View>
              }
              contentContainerStyle={{ paddingBottom: bottomClearance }}
            />
          </View>
        }
      >
        {!loaded ? (
          // Blank until the local query resolves (fast); a quiet blank, not a
          // skeleton (DESIGN §11). There's no empty state — your own entry
          // is always present, so the list is never empty.
          <View style={{ flex: 1 }} />
        ) : (
          <ContactSectionList
            ref={groupedListRef}
            entries={entries}
            onSelect={openChat}
            onScroll={scrollProps.onScroll}
            // Inactive search affordance at the top of the list (visible at rest);
            // tapping it opens the real (autofocused) search.
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
                  placeholder={t('search.contacts_placeholder')}
                  shortcutHint={SEARCH_ACTIVATION_SHORTCUT_LABEL}
                  onPress={openSearch}
                />
              </View>
            }
            contentBottomInset={bottomClearance}
          />
        )}
      </SearchTransition>
      <ScreenHeader
        back={false}
        bordered={scrolled}
        title={t('tabs.contacts')}
        right={
          <View>
            <IconButton
              variant="plain"
              size={uiDensity.headerActionSize}
              onPress={() => openInDetailPane('/add-contact')}
              hitSlop={6}
              icon={<UserPlus size={uiDensity.headerActionIconSize} color={c.text} />}
              accessibilityLabel={t('contacts.add')}
            />
            {unreadRequestCount > 0 ? (
              <NotificationDot style={{ position: 'absolute', top: 5, end: 5 }} />
            ) : null}
          </View>
        }
      />
    </AppScreen>
  );
}
