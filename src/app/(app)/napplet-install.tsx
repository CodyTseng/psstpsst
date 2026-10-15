import { useState } from 'react';
import { ScrollView } from 'react-native';
import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { AppScreen } from '@/components/common/AppScreen';
import { AppText } from '@/components/common/AppText';
import { AppInput } from '@/components/common/AppInput';
import { AppButton } from '@/components/common/AppButton';
import { ScreenHeader, useScreenHeaderClearance } from '@/components/common/ScreenHeader';
import { nappletService, nappletStore } from '@/services/napplet/service';
import { spacing, useThemeColors } from '@/theme';

export default function NappletInstallScreen() {
  const { t } = useTranslation();
  const c = useThemeColors();
  const clearance = useScreenHeaderClearance();
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
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
          onChangeText={setValue}
          autoCapitalize="none"
          autoCorrect={false}
          multiline
        />
        <AppText tone="muted">{t('napplets.address_hint')}</AppText>
        {error ? <AppText style={{ color: c.danger }}>{t('napplets.not_found')}</AppText> : null}
        <AppButton
          label={t('napplets.details')}
          disabled={!value.trim()}
          loading={busy}
          onPress={() => {
            setBusy(true);
            setError(false);
            void nappletService
              .resolve(value)
              .then((release) => {
                nappletStore.setState((state) => ({
                  market: [release, ...state.market.filter((app) => app.key !== release.key)],
                }));
                router.replace({ pathname: '/napplet/[id]', params: { id: release.event.id } });
              })
              .catch(() => setError(true))
              .finally(() => setBusy(false));
          }}
        />
      </ScrollView>
    </AppScreen>
  );
}
