import { router } from 'expo-router';
import { ForbiddenCircle } from '@solar-icons/react-native/category/ui/Linear/ForbiddenCircle';
import { useTranslation } from 'react-i18next';
import { ScrollView, View } from 'react-native';

import { AppScreen } from '@/components/common/AppScreen';
import { AppText } from '@/components/common/AppText';
import { ScreenHeader, useScreenHeaderClearance } from '@/components/common/ScreenHeader';
import { useScrolled } from '@/hooks/use-scrolled';
import { useBlockedProximityPeers } from '@/hooks/use-proximity';
import { useActiveAccount } from '@/stores/active-account.store';
import { spacing, useThemeColors } from '@/theme';

import { NearbyPeerListItem } from './NearbyPeerListItem';

/** Device-local proximity block list, separate from the synced Nostr block list. */
export function NearbyBlockedDevices() {
  const { scrolled, scrollProps } = useScrolled();
  const { t } = useTranslation();
  const c = useThemeColors();
  const top = useScreenHeaderClearance();
  const accountPubkey = useActiveAccount((state) => state.activePubkey) ?? '';
  const { peers, loaded } = useBlockedProximityPeers(accountPubkey);

  return (
    <AppScreen edges={['bottom']}>
      <ScrollView
        {...scrollProps}
        contentContainerStyle={{
          flexGrow: 1,
          paddingTop: top,
          paddingBottom: spacing.xl,
        }}
        showsVerticalScrollIndicator={false}
      >
        {peers && peers.length > 0 ? (
          peers.map((peer, index) => {
            const name = peer.nickname || peer.displayName;
            return (
              <NearbyPeerListItem
                key={peer.proximityPubkey}
                pubkey={peer.proximityPubkey}
                displayName={name}
                secondaryText={t('nearby.blocked_device')}
                showSeparator={index < peers.length - 1}
                onPress={() =>
                  router.push({
                    pathname: '/nearby-contact/[pubkey]',
                    params: { pubkey: peer.proximityPubkey, name },
                  })
                }
              />
            );
          })
        ) : loaded ? (
          <View
            style={{
              flex: 1,
              alignItems: 'center',
              justifyContent: 'center',
              gap: spacing.sm,
              paddingHorizontal: spacing.lg,
            }}
          >
            <ForbiddenCircle size={40} color={c.textMuted} />
            <AppText variant="subtitle" weight="semibold" align="center">
              {t('nearby.blocked_empty_title')}
            </AppText>
            <AppText variant="body" tone="muted" align="center">
              {t('nearby.blocked_empty_message')}
            </AppText>
          </View>
        ) : null}
      </ScrollView>
      <ScreenHeader bordered={scrolled} title={t('nearby.blocked_devices')} />
    </AppScreen>
  );
}
