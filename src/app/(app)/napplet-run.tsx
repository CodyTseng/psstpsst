import { useCallback, useEffect } from 'react';
import { View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { useIsFocused } from 'expo-router/react-navigation';
import { ForwardTargetScreen } from '@/components/share/ForwardTargetScreen';
import { AppScreen } from '@/components/common/AppScreen';
import { ScreenHeader, useScreenHeaderClearance } from '@/components/common/ScreenHeader';
import { useTranslation } from 'react-i18next';
import X from 'lucide-react-native/icons/x';
import Ellipsis from 'lucide-react-native/icons/ellipsis';
import { IconButton } from '@/components/common/IconButton';
import { spacing, uiDensity, useThemeColors } from '@/theme';
import { NappletSurface } from '@/platform/napplet-surface';
import { nappletService } from '@/services/napplet/service';
import { useNapplets } from '@/stores/napplet.store';

export default function NappletRunScreen() {
  const { running, launching, prompt, configuration, panel, overlayActive, sharing, accountPubkey } = useNapplets();
  const focused = useIsFocused();
  const { t } = useTranslation();
  const c = useThemeColors();
  const closeShare = useCallback(() => { if (accountPubkey && running) nappletService.closeShare(accountPubkey, running.containerId); }, [accountPubkey, running]);
  const clearance = useScreenHeaderClearance();
  useFocusEffect(useCallback(() => () => nappletService.stop(), []));
  useEffect(() => {
    if (focused && !running && !launching && !panel) router.back();
  }, [running, launching, panel, focused]);
  return (
    <AppScreen edges={['bottom']}>
      <View style={{ flex: 1, display: sharing ? 'none' : 'flex' }}>
      <ScreenHeader title={running?.release.title ?? panel?.release.title} back={false}
        titleSideInset={uiDensity.iconButtonSize * 2 + spacing.lg}
        right={<View style={{ flexDirection: 'row', gap: spacing.xs }}>
          <IconButton icon={<Ellipsis size={uiDensity.headerActionIconSize} color={c.text} />}
            accessibilityLabel={t('napplets.runtime_more')} onPress={() => nappletService.openPanel('about')} disabled={!running} />
          <IconButton icon={<X size={uiDensity.headerActionIconSize} color={c.text} />}
            accessibilityLabel={t('common.close')} onPress={() => nappletService.stop()} />
        </View>} />
      <View style={{ flex: 1, paddingTop: clearance }}>
        {running ? (
          <NappletSurface id={running.containerId} visible={focused && !sharing && !prompt && !configuration && !panel && !overlayActive} />
        ) : null}
      </View>
      </View>
      {sharing ? <ForwardTargetScreen onClose={closeShare} stayInSource /> : null}
    </AppScreen>
  );
}
