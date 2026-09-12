import { router } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { AppFormScrollView } from '@/components/common/AppFormScrollView';
import { AppButton } from '@/components/common/AppButton';
import { AppContentColumn } from '@/components/common/AppContentColumn';
import { AppInput } from '@/components/common/AppInput';
import { AppScreen } from '@/components/common/AppScreen';
import { AppText } from '@/components/common/AppText';
import { OnboardingFormLayout } from '@/components/onboarding/OnboardingFormLayout';
import { useScrolled } from '@/hooks/use-scrolled';
import { useFocusAfterTransition } from '@/hooks/use-focus-after-transition';
import { addAccountFromNsec } from '@/services/account/account.service';
import { useActiveAccount } from '@/stores/active-account.store';
import { spacing } from '@/theme';

export default function LoginNsec() {
  const { scrolled, scrollProps } = useScrolled();
  const { t } = useTranslation();
  const [nsec, setNsec] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const setActive = useActiveAccount((s) => s.setActive);
  const nsecRef = useFocusAfterTransition();

  async function submit() {
    setError(null);
    setLoading(true);
    try {
      const { pubkey } = await addAccountFromNsec(nsec.trim());
      await setActive(pubkey);
      router.replace('/');
    } catch (e) {
      setError((e as Error).message || t('login.nsec.invalid'));
      setLoading(false);
    }
  }

  return (
    <AppScreen edges={['bottom']}>
      <OnboardingFormLayout bordered={scrolled} title={t('login.nsec.title')}>
        <AppContentColumn>
          <AppFormScrollView
            {...scrollProps}
            contentContainerStyle={{
              flexGrow: 1,
              paddingHorizontal: spacing.lg,
              paddingTop: spacing.sm,
              paddingBottom: spacing.xl,
              gap: spacing.xl,
            }}
          >
            <AppText variant="body" tone="muted">
              {t('login.nsec.subtitle')}
            </AppText>

            <AppInput
              ref={nsecRef}
              placeholder={t('login.nsec.placeholder')}
              value={nsec}
              onChangeText={setNsec}
              autoCapitalize="none"
              autoCorrect={false}
              secureTextEntry
              error={error ?? undefined}
            />

            <AppButton
              label={t('login.nsec.submit')}
              variant="primary"
              size="lg"
              loading={loading}
              disabled={!nsec.trim()}
              onPress={submit}
            />
          </AppFormScrollView>
        </AppContentColumn>
      </OnboardingFormLayout>
    </AppScreen>
  );
}
