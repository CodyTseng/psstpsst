import { router } from 'expo-router';
import { ForbiddenCircle as Ban } from '@solar-icons/react-native/category/ui/Linear/ForbiddenCircle';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FlatList, View } from 'react-native';

import { BlockedListItem } from '@/components/blocked/BlockedListItem';
import { AppScreen } from '@/components/common/AppScreen';
import { AppText } from '@/components/common/AppText';
import { ScreenHeader, useScreenHeaderClearance } from '@/components/common/ScreenHeader';
import { useScrolled } from '@/hooks/use-scrolled';
import { useBlockedUsers } from '@/hooks/use-blocked';
import { useActiveAccount } from '@/stores/active-account.store';
import { useThemeColors } from '@/theme';

export default function BlockedUsers() {
  const { scrolled, scrollProps } = useScrolled();
  const { t } = useTranslation();
  const c = useThemeColors();
  const titleClearance = useScreenHeaderClearance();
  const accountPubkey = useActiveAccount((s) => s.activePubkey);
  const { blocked, loaded } = useBlockedUsers(accountPubkey ?? '');

  // Keep every pubkey shown this session, even after it's unblocked, so the row
  // doesn't vanish on Unblock — it flips to "Block" for an easy re-block. Append
  // newly-blocked pubkeys; the set is rebuilt on the next screen entry, so a
  // row left unblocked is gone next time.
  const [shown, setShown] = useState<string[]>([]);
  const blockedKeys = blocked.map((b) => b.pubkey).join(',');
  useEffect(() => {
    if (!loaded) return;
    setShown((prev) => {
      const seen = new Set(prev);
      const added = blocked.map((b) => b.pubkey).filter((pk) => !seen.has(pk));
      return added.length ? [...prev, ...added] : prev;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [blockedKeys, loaded]);

  return (
    <AppScreen edges={[]}>
      {!loaded ? (
        // Blank until the first query resolves, so the empty state never flashes
        // before the list lands (DESIGN §12 rule 17). Fast local query → blank.
        <View style={{ flex: 1, paddingTop: titleClearance }} />
      ) : shown.length === 0 ? (
        <View
          style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, padding: 24, paddingTop: titleClearance + 24 }}
        >
          <Ban size={40} color={c.textMuted} />
          <AppText variant="subtitle" tone="muted">
            {t('blocked.empty')}
          </AppText>
        </View>
      ) : (
        <FlatList
          {...scrollProps}
          data={shown}
          contentContainerStyle={{ paddingTop: titleClearance }}
          keyExtractor={(pubkey) => pubkey}
          renderItem={({ item: pubkey }) => (
            <BlockedListItem
              accountPubkey={accountPubkey!}
              pubkey={pubkey}
              onPress={() => router.push(`/profile/${encodeURIComponent(pubkey)}`)}
            />
          )}
        />
      )}
      <ScreenHeader bordered={scrolled} title={t('blocked.title')} />
    </AppScreen>
  );
}
