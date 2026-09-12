import { router } from 'expo-router';
import Check from 'lucide-react-native/icons/check';
import { Copy } from '@solar-icons/react-native/category/ui/Linear/Copy';
import { ShieldWarning as ShieldAlert } from '@solar-icons/react-native/category/security/Linear/ShieldWarning';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ScrollView, View } from 'react-native';

import { AppButton } from '@/components/common/AppButton';
import { AppCard } from '@/components/common/AppCard';
import { AppContentColumn } from '@/components/common/AppContentColumn';
import { AppScreen } from '@/components/common/AppScreen';
import { AppText } from '@/components/common/AppText';
import { OnboardingFormLayout } from '@/components/onboarding/OnboardingFormLayout';
import { setStringAsync } from '@/lib/clipboard';
import {
  generateAccountKeyMaterial,
  persistGeneratedAccount,
} from '@/services/account/account.service';
import { useScrolled } from '@/hooks/use-scrolled';
import { iconStrokeWidth } from '@/theme/icons';
import { spacing, useThemeColors } from '@/theme';

export default function Generate() {
  const { scrolled, scrollProps } = useScrolled();
  const { t } = useTranslation();
  const c = useThemeColors();
  // Generate the keypair in memory only. The account is persisted (SQLite row
  // + secure-storage privkey) only when the user confirms the backup below —
  // leaving this screen early must not leave a half-created account behind.
  const [keyMaterial] = useState(() => generateAccountKeyMaterial());
  const [continuing, setContinuing] = useState(false);
  const [copied, setCopied] = useState(false);
  const { nsec } = keyMaterial;

  async function handleCopy() {
    await setStringAsync(nsec);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  async function handleContinue() {
    if (continuing) return;
    setContinuing(true);
    try {
      const { pubkey: savedPubkey } = await persistGeneratedAccount(keyMaterial.privkeyHex);
      // The optional NIP-05 claim step comes next; the account is activated
      // (setActive bootstrap) only when that step finishes or is skipped.
      router.push({ pathname: '/nip05', params: { pubkey: savedPubkey } });
    } finally {
      setContinuing(false);
    }
  }

  return (
    <AppScreen edges={['bottom']}>
      <OnboardingFormLayout bordered={scrolled} title={t('generate.title')}>
        <AppContentColumn>
          <ScrollView
            {...scrollProps}
            contentContainerStyle={{
              paddingHorizontal: spacing.lg,
              paddingTop: spacing.sm,
              paddingBottom: spacing['2xl'],
              gap: spacing.xl,
            }}
          >
            <AppText variant="body" tone="muted">
              {t('generate.subtitle')}
            </AppText>

            <AppCard
              variant="outlined"
              style={{
                flexDirection: 'row',
                alignItems: 'flex-start',
                gap: spacing.md,
                backgroundColor: c.warningSoft,
                borderColor: 'transparent',
              }}
            >
              <View style={{ marginTop: spacing.xs }}>
                <ShieldAlert size={18} color={c.warning} />
              </View>
              <AppText variant="caption" tone="warning" style={{ flex: 1 }}>
                {t('generate.warning')}
              </AppText>
            </AppCard>

            <AppCard variant="muted" style={{ gap: spacing.sm }}>
              <AppText variant="caption" tone="subtle" weight="medium">
                NSEC
              </AppText>
              <AppText variant="code" selectable>
                {nsec}
              </AppText>
              <View style={{ alignSelf: 'flex-start', marginTop: spacing.xs }}>
                <AppButton
                  label={copied ? t('generate.copied') : t('generate.copy')}
                  variant="secondary"
                  size="sm"
                  fullWidth={false}
                  iconLeft={
                    copied ? (
                      <Check strokeWidth={iconStrokeWidth.compact} size={14} color={c.success} />
                    ) : (
                      <Copy size={14} color={c.text} />
                    )
                  }
                  onPress={() => void handleCopy()}
                />
              </View>
            </AppCard>

            <AppButton
              label={t('generate.continue')}
              variant="primary"
              size="lg"
              loading={continuing}
              onPress={() => void handleContinue()}
            />
          </ScrollView>
        </AppContentColumn>
      </OnboardingFormLayout>
    </AppScreen>
  );
}
