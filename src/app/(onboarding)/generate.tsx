import { router } from 'expo-router';
import Check from 'lucide-react-native/icons/check';
import { Copy } from '@solar-icons/react-native/category/ui/Linear/Copy';
import { ShieldWarning as ShieldAlert } from '@solar-icons/react-native/category/security/Linear/ShieldWarning';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ScrollView, View } from 'react-native';

import { AppButton } from '@/components/common/AppButton';
import { AppCard } from '@/components/common/AppCard';
import { AppContentColumn } from '@/components/common/AppContentColumn';
import { AppScreen } from '@/components/common/AppScreen';
import { AppText } from '@/components/common/AppText';
import { OnboardingFormLayout } from '@/components/onboarding/OnboardingFormLayout';
import { platform } from '@/platform';
import type { MessagingKey } from '@/platform/ports/key-vault';
import {
  generateAccountKeyMaterial,
  copyIdentityBackup,
  discardGeneratedAccount,
  persistGeneratedAccount,
} from '@/services/account/account.service';
import { useClipboard } from '@/hooks/use-clipboard';
import { useScrolled } from '@/hooks/use-scrolled';
import { iconStrokeWidth } from '@/theme/icons';
import { spacing, useThemeColors } from '@/theme';

export default function Generate() {
  const { scrolled, scrollProps } = useScrolled();
  const { t, i18n } = useTranslation();
  const { copied, copyWith } = useClipboard();
  const [backupCompleted, setBackupCompleted] = useState(false);
  const c = useThemeColors();
  // Generate the keypair in memory only. The account is persisted (SQLite row
  // + secure-storage privkey) only when the user confirms the backup below —
  // leaving this screen early must not leave a half-created account behind.
  const [keyMaterial, setKeyMaterial] = useState<MessagingKey | null>(null);
  useEffect(() => {
    let active = true;
    const work = generateAccountKeyMaterial();
    void work.then(key => {
      if (active) setKeyMaterial(key);
      else void discardGeneratedAccount(key.pubkey).catch(() => {});
    }).catch(() => { void platform.confirmationDialog.notify({ title: i18n.t('settings.export_nsec_failed'), okLabel: i18n.t('common.ok') }); });
    return () => {
      active = false;
      void work.then(key => discardGeneratedAccount(key.pubkey)).catch(() => {});
    };
  }, [i18n]);
  const [continuing, setContinuing] = useState(false);

  const [copying, setCopying] = useState(false);
  async function handleCopy() {
    if (!keyMaterial || copying) return;
    setCopying(true);
    try {
      const result = await copyWith(() => copyIdentityBackup(keyMaterial.pubkey, i18n.language));
      if (result) setBackupCompleted(true);
    } finally { setCopying(false); }
  }

  async function handleContinue() {
    if (continuing || !keyMaterial || !backupCompleted) return;
    setContinuing(true);
    try {
      const { pubkey: savedPubkey } = await persistGeneratedAccount(keyMaterial.pubkey);
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
              <AppText variant="body" tone="muted">{t('generate.backup_hint')}</AppText>
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
                  loading={copying || !keyMaterial}
                  disabled={!keyMaterial || continuing}
                  onPress={() => void handleCopy()}
                />
              </View>
            </AppCard>

            <View style={{ gap: spacing.sm }}>
              <AppButton
                label={t('generate.continue')}
                variant="primary"
                size="lg"
                loading={continuing}
                disabled={!keyMaterial || !backupCompleted}
                onPress={() => void handleContinue()}
              />
              {!backupCompleted && (
                <AppText variant="caption" tone="muted">
                  {t('generate.continue_hint')}
                </AppText>
              )}
            </View>
          </ScrollView>
        </AppContentColumn>
      </OnboardingFormLayout>
    </AppScreen>
  );
}
