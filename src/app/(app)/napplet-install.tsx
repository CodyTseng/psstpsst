import { useState } from 'react';
import { ScrollView } from 'react-native';
import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { AppScreen } from '@/components/common/AppScreen';
import { AppText } from '@/components/common/AppText';
import { AppInput } from '@/components/common/AppInput';
import { AppButton } from '@/components/common/AppButton';
import { QrScanButton } from '@/components/common/QrScanButton';
import { ScreenHeader, useScreenHeaderClearance } from '@/components/common/ScreenHeader';
import { exploreService, exploreStore } from '@/services/explore/service';
import { spacing, useThemeColors } from '@/theme';

export default function NappletInstallScreen() {
  const { t } = useTranslation();
  const c = useThemeColors();
  const clearance = useScreenHeaderClearance();
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  function lookup(address: string) {
    if (busy || !address.trim()) return;
    setBusy(true);
    setError(null);
    void exploreService
      .resolve(address)
      .then((release) => {
        if(release.release) router.replace({ pathname: '/napplet/[id]', params: { id: release.release.event.id } });
        else { const account=exploreStore.getState().account;if(!account) throw new Error('account-unavailable');
          const runId=exploreService.prepare(release,account);router.replace({pathname:'/explore-run',params:{runId}}); }
      })
      .catch((error: Error) => setError(error.message.startsWith('napplets.') ? error.message : 'napplets.request_failed'))
      .finally(() => setBusy(false));
  }
  return (
    <AppScreen edges={[]}>
      <ScreenHeader title={t('napplets.install_link')} />
      <ScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{
          padding: spacing.lg,
          paddingTop: clearance + spacing.lg,
          gap: spacing.lg,
        }}
      >
        <AppInput
          label={t('napplets.address')}
          maxLength={8192}
          value={value}
          onChangeText={(text) => { setValue(text); setError(null); }}
          autoCapitalize="none"
          autoCorrect={false}
          editable={!busy}
          returnKeyType="go"
          onSubmitEditing={() => lookup(value)}
          trailingAccessory={<QrScanButton onScanned={(data) => {
            setValue(data.trim());
            lookup(data);
          }} />}
        />
        <AppText tone="muted">{t('napplets.address_hint')}</AppText>
        {error ? <AppText style={{ color: c.danger }}>{t(error)}</AppText> : null}
        <AppButton
          label={t('napplets.open')}
          disabled={!value.trim()}
          loading={busy}
          onPress={() => lookup(value)}
        />
      </ScrollView>
    </AppScreen>
  );
}
