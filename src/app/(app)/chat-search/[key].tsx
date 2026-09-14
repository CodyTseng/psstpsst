import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, FlatList, View } from 'react-native';

import { ChromeDivider } from '@/components/common/ChromeDivider';
import { AppScreen } from '@/components/common/AppScreen';
import { AppText } from '@/components/common/AppText';
import { ScreenHeader, useScreenHeaderClearance } from '@/components/common/ScreenHeader';
import { SearchBar, SEARCH_BAR_SCREEN_GUTTER } from '@/components/search/SearchBar';
import { SearchResultRow } from '@/components/search/SearchResultRow';
import { InvalidRouteRedirect } from '@/components/navigation/InvalidRouteRedirect';
import { useScrolled } from '@/hooks/use-scrolled';
import { useFocusAfterTransition } from '@/hooks/use-focus-after-transition';
import { type MessageSearchHit, useMessageSearch } from '@/hooks/use-message-search';
import { parseConversationRouteParams } from '@/lib/navigation/route-params';
import { useActiveAccount } from '@/stores/active-account.store';
import { useThemeColors } from '@/theme';

/**
 * In-conversation message search — reached from a peer's profile. Searches only
 * this thread (`useMessageSearch` scoped by `conversationKey`); tapping a hit
 * navigates to the chat and jumps to that message (`?focus`). `router.navigate`
 * (not push) so we don't stack a second copy of an already-open chat.
 */
export default function ChatSearch() {
  const { scrolled, scrollProps } = useScrolled();
  const { t } = useTranslation();
  const c = useThemeColors();
  const titleClearance = useScreenHeaderClearance();
  const params = useLocalSearchParams<{
    key: string | string[];
    transport?: string | string[];
    name?: string | string[];
  }>();
  const route = parseConversationRouteParams(params);
  const conversationKey = route?.key ?? '';
  const isProximity = route?.transport === 'proximity';
  const accountPubkey = useActiveAccount((s) => s.activePubkey) ?? '';
  const [query, setQuery] = useState('');
  const searchRef = useFocusAfterTransition();

  const { results, searching, loadingMore, loadMore } = useMessageSearch(
    accountPubkey,
    query,
    conversationKey,
  );

  // Every hit is in this one thread; the conversation_key IS the counterparty.
  const counterparty = conversationKey;

  const q = query.trim();

  function openAt(hit: MessageSearchHit) {
    router.navigate({
      pathname: '/chat/[key]',
      params: {
        key: conversationKey,
        focus: hit.id,
        focusOrderAt: String(hit.orderAt),
        ...(isProximity ? { transport: 'proximity', name: route?.name ?? '' } : {}),
      },
    });
  }

  if (!route) return <InvalidRouteRedirect />;

  return (
    <AppScreen edges={[]}>
      <View
        style={{
          paddingHorizontal: SEARCH_BAR_SCREEN_GUTTER,
          paddingTop: titleClearance,
          paddingBottom: 8,
        }}
      >
        <SearchBar ref={searchRef} value={query} onChangeText={setQuery} />
      </View>
      <View style={{ flex: 1 }}>
        <FlatList
          {...scrollProps}
          data={results}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          keyExtractor={(hit) => hit.id}
          renderItem={({ item }) => (
            <SearchResultRow
              counterpartyPubkey={counterparty}
              avatarPubkey={item.senderPubkey}
              conversationName={isProximity ? route.name ?? null : null}
              identityKind={isProximity ? 'proximity' : 'relay'}
              subtitle={item.snippet}
              boldSnippet
              timestamp={item.createdAt}
              onPress={() => openAt(item)}
            />
          )}
          onEndReached={() => loadMore()}
          onEndReachedThreshold={0.6}
          ListFooterComponent={
            loadingMore ? (
              <View style={{ padding: 16 }}>
                <ActivityIndicator color={c.textMuted} />
              </View>
            ) : null
          }
          ListEmptyComponent={
            q.length > 0 && !searching ? (
              <View style={{ paddingTop: 48, alignItems: 'center' }}>
                <AppText variant="body" tone="muted">
                  {t('search.empty')}
                </AppText>
              </View>
            ) : null
          }
        />
        <ChromeDivider visible={scrolled} edge="top" />
      </View>
      <ScreenHeader title={t('search.in_conversation')} />
    </AppScreen>
  );
}
