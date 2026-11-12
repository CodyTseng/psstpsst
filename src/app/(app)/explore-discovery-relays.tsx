import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Keyboard, StyleSheet, View } from 'react-native';

import { AppScreen } from '@/components/common/AppScreen';
import { ScreenHeader, useScreenHeaderClearance } from '@/components/common/ScreenHeader';
import { SegmentedControl } from '@/components/common/SegmentedControl';
import { RelaySettingsForm } from '@/components/settings/RelaySettingsScreen';
import { useScrolled } from '@/hooks/use-scrolled';
import type { DiscoveryFormat } from '@/services/explore/discovery-relays';
import { useActiveAccount } from '@/stores/active-account.store';
import { spacing, useThemeColors } from '@/theme';

export default function DiscoveryRelaysScreen() {
  const { t } = useTranslation();
  const account = useActiveAccount(s => s.activePubkey);
  const [format, setFormat] = useState<DiscoveryFormat>('napp');
  const c = useThemeColors();
  const [visitedNapplet, setVisitedNapplet] = useState(false);
  const clearance = useScreenHeaderClearance();
  const nappScroll = useScrolled();
  const nappletScroll = useScrolled();
  const scrolled = (format === 'napp' ? nappScroll : nappletScroll).scrolled;

  return <AppScreen edges={['bottom']}>
    <View style={{ paddingTop: clearance + spacing.sm, paddingHorizontal: spacing.lg, paddingBottom: spacing.sm }}>
      <SegmentedControl value={format} options={[
        { value: 'napp', label: 'napps' },
        { value: 'napplet', label: 'napplets' },
      ]} onChange={next => {
        Keyboard.dismiss();
        if (next === 'napplet') setVisitedNapplet(true);
        setFormat(next);
      }} />
      {scrolled && <View style={{ position: 'absolute', bottom: 0, start: 0, end: 0, height: StyleSheet.hairlineWidth, backgroundColor: c.border }} />}
    </View>
    <View testID="discovery-panel-napp" style={{ flex: 1, display: format === 'napp' ? 'flex' : 'none' }}>
      <RelaySettingsForm key={`${account}:napp`} mode="napp" accountPubkey={account} scrollProps={nappScroll.scrollProps} />
    </View>
    {visitedNapplet && <View testID="discovery-panel-napplet" style={{ flex: 1, display: format === 'napplet' ? 'flex' : 'none' }}>
      <RelaySettingsForm key={`${account}:napplet`} mode="napplet" accountPubkey={account} scrollProps={nappletScroll.scrollProps} />
    </View>}
    <ScreenHeader title={t('applications.discovery_relays')} />
  </AppScreen>;
}
