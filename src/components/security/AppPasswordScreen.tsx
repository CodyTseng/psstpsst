import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { KeyboardAvoidingView, View } from 'react-native';

import { AppBrandMark } from '@/components/common/AppBrandMark';
import { AppButton } from '@/components/common/AppButton';
import { AppContentColumn } from '@/components/common/AppContentColumn';
import { AppInput } from '@/components/common/AppInput';
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
  const { t } = useTranslation();
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const validSetup = password.length >= 8 && password === confirmation;

  async function submit() {
    if (submitting || (mode === 'setup' && !validSetup) || !password) return;
    setSubmitting(true);
    setError(null);
    try {
      if (mode === 'setup') {
        await platform.secureStorage.configurePassword(password);
        onUnlocked();
        return;
      }
      if (await platform.secureStorage.unlockWithPassword(password)) {
        onUnlocked();
      } else {
        setError(t('secure_storage.wrong_password'));
      }
    } catch {
      setError(t('secure_storage.failed'));
    } finally {
      setSubmitting(false);
    }
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

            <View style={{ gap: spacing.md }}>
              <AppInput
                value={password}
                onChangeText={setPassword}
                placeholder={t('secure_storage.password')}
                secureTextEntry
                maxLength={256}
                autoCapitalize="none"
                autoCorrect={false}
                textContentType="password"
                description={
                  mode === 'setup' ? t('secure_storage.recovery_warning') : undefined
                }
                error={mode === 'unlock' ? error ?? undefined : undefined}
                onSubmitEditing={() => {
                  if (mode === 'unlock') void submit();
                }}
              />
              {mode === 'setup' ? (
                <AppInput
                  value={confirmation}
                  onChangeText={setConfirmation}
                  placeholder={t('secure_storage.confirm_password')}
                  secureTextEntry
                  maxLength={256}
                  autoCapitalize="none"
                  autoCorrect={false}
                  textContentType="newPassword"
                  invalid={confirmation.length > 0 && password !== confirmation}
                  error={error ?? undefined}
                  onSubmitEditing={() => void submit()}
                />
              ) : null}
            </View>
          </View>

          <AppButton
            label={t(mode === 'setup' ? 'secure_storage.create' : 'secure_storage.unlock')}
            variant="primary"
            size="lg"
            loading={submitting}
            disabled={mode === 'setup' ? !validSetup : !password}
            onPress={() => void submit()}
          />
        </AppContentColumn>
      </KeyboardAvoidingView>
    </AppScreen>
  );
}
