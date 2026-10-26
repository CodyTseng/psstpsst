import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { KeyboardAvoidingView, View } from 'react-native';

import { AppBrandMark } from '@/components/common/AppBrandMark';
import { AppButton } from '@/components/common/AppButton';
import { AppContentColumn } from '@/components/common/AppContentColumn';
import { AppScreen } from '@/components/common/AppScreen';
import { AppText } from '@/components/common/AppText';
import { KEYBOARD_AVOIDING_BEHAVIOR } from '@/lib/platform';
import { platform } from '@/platform';
import { spacing } from '@/theme';

type Props = {
  mode: 'setup' | 'unlock';
  onUnlocked: () => void;
};

/** First-run fallback when the OS cannot provide credential-grade secret storage. */
export function AppPasswordScreen({ mode, onUnlocked }: Props) {
  const { t, i18n } = useTranslation();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (submitting) return;
    setSubmitting(true); setError(null);
    try {
      if (await platform.security.requestUnlock(mode, { language: i18n.language })) onUnlocked();
    } catch { setError(t('secure_storage.failed')); }
    finally { setSubmitting(false); }
  }

  return (
    <AppScreen edges={['top', 'bottom']}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={KEYBOARD_AVOIDING_BEHAVIOR}>
        <AppContentColumn style={{ padding: spacing.lg }}>
          <View style={{ flex: 1, justifyContent: 'center', gap: spacing.xl }}>
            <View style={{ alignItems: 'center', gap: spacing.md }}>
              <AppBrandMark />
              <AppText variant="title" weight="semibold" align="center">
                {t(mode === 'setup' ? 'secure_storage.setup_title' : 'secure_storage.unlock_title')}
              </AppText>
              <AppText variant="body" tone="muted" align="center">
                {t(mode === 'setup' ? 'secure_storage.setup_hint' : 'secure_storage.unlock_hint')}
              </AppText>
            </View>

            {error ? <AppText variant="body" tone="danger">{error}</AppText> : null}
          </View>

          <AppButton
            label={t(mode === 'setup' ? 'secure_storage.create' : 'secure_storage.unlock')}
            variant="primary"
            size="lg"
            loading={submitting}
            onPress={() => void submit()}
          />
        </AppContentColumn>
      </KeyboardAvoidingView>
    </AppScreen>
  );
}
