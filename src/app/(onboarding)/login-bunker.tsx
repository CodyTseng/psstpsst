import { router } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { AppFormScrollView } from '@/components/common/AppFormScrollView';
import { AppButton } from '@/components/common/AppButton';
import { AppContentColumn } from '@/components/common/AppContentColumn';
import { AppInput } from '@/components/common/AppInput';
import { AppScreen } from '@/components/common/AppScreen';
import { AppText } from '@/components/common/AppText';
import { OrDivider } from '@/components/common/OrDivider';
import { QrScanButton } from '@/components/common/QrScanButton';
import { OnboardingFormLayout } from '@/components/onboarding/OnboardingFormLayout';
import { useScrolled } from '@/hooks/use-scrolled';
import { useFocusAfterTransition } from '@/hooks/use-focus-after-transition';
import { loginWithBunker } from '@/services/signer/nip46-connect.service';
import { useActiveAccount } from '@/stores/active-account.store';
import { spacing } from '@/theme';

export default function LoginBunker() {
  const { scrolled, scrollProps } = useScrolled();
  const { t } = useTranslation();
  const [input, setInput] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const setActive = useActiveAccount((s) => s.setActive);
  const inputRef = useFocusAfterTransition();

  async function submit() {
    setError(null);
    setLoading(true);
    try {
      const { pubkey } = await loginWithBunker(input.trim());
      await setActive(pubkey);
      router.replace('/');
    } catch {
      setError(t('login.bunker.invalid'));
      setLoading(false);
    }
  }

  return (
    <AppScreen edges={['bottom']}>
      <OnboardingFormLayout bordered={scrolled} title={t('login.bunker.title')}>
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
              {t('login.bunker.subtitle')}
            </AppText>

            <AppInput
              ref={inputRef}
              placeholder={t('login.bunker.placeholder')}
              value={input}
              onChangeText={setInput}
              autoCapitalize="none"
              autoCorrect={false}
              description={loading ? t('login.bunker.connecting') : undefined}
              error={error ?? undefined}
              editable={!loading}
              trailingAccessory={<QrScanButton onScanned={(data) => setInput(data.trim())} />}
            />

            <View style={{ gap: spacing.lg }}>
              <AppButton
                label={t('login.bunker.submit')}
                variant="primary"
                size="lg"
                loading={loading}
                disabled={!input.trim()}
                onPress={submit}
              />

              <OrDivider label={t('common.or')} />

              <AppButton
                label={t('login.bunker.use_nostr_connect')}
                variant="secondary"
                size="lg"
                disabled={loading}
                onPress={() => router.push('/login-nostr-connect')}
              />
            </View>
          </AppFormScrollView>
        </AppContentColumn>
      </OnboardingFormLayout>
    </AppScreen>
  );
}
