import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { type TextInput, View } from 'react-native';

import { ActionRow } from '@/components/common/ActionRow';
import { AppInput } from '@/components/common/AppInput';
import { BottomSheet } from '@/components/common/BottomSheet';
import { InputDialog } from '@/components/common/InputDialog';
import { IS_ELECTRON } from '@/lib/platform';
import { contentWidth, spacing } from '@/theme';

type Props = {
  visible: boolean;
  mode: 'verify' | 'setup';
  onClose: () => void;
  onSubmit: (pin: string) => Promise<boolean>;
  onClosed?: () => void;
};

/** Six-digit wallet-authentication sheet used when system auth is unavailable.
 * On Electron it takes the centered input-dialog form (DESIGN §10 Electron
 * presentation split) since it is a pure value entry. */
export function WalletPinSheet({ visible, mode, onClose, onSubmit, onClosed }: Props) {
  const { t } = useTranslation();
  const [pin, setPin] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [invalid, setInvalid] = useState(false);
  const pinInputRef = useRef<TextInput>(null);

  const complete = /^\d{6}$/.test(pin) && (mode === 'verify' || pin === confirmation);

  function close() {
    setPin('');
    setConfirmation('');
    setInvalid(false);
    onClose();
  }

  async function submit() {
    if (!complete || submitting) return;
    setSubmitting(true);
    setInvalid(false);
    try {
      if (await onSubmit(pin)) {
        setPin('');
        setConfirmation('');
        onClose();
      } else {
        setInvalid(true);
        setPin('');
      }
    } catch {
      setInvalid(true);
      setPin('');
    } finally {
      setSubmitting(false);
    }
  }

  const supportingText = t(
    invalid
      ? 'wallet.pin_incorrect'
      : mode === 'setup'
        ? 'wallet.pin_setup_hint'
        : 'wallet.pin_prompt',
  );

  const fields = (
    <>
      <AppInput
        ref={pinInputRef}
        value={pin}
        onChangeText={(next) => {
          setPin(next.replace(/\D/g, '').slice(0, 6));
          setInvalid(false);
        }}
        placeholder={t('wallet.pin')}
        keyboardType="number-pad"
        secureTextEntry
        maxLength={6}
        invalid={invalid}
        description={mode === 'verify' ? t('wallet.pin_prompt') : undefined}
        error={mode === 'verify' && invalid ? supportingText : undefined}
        onSubmitEditing={() => {
          if (mode === 'verify') void submit();
        }}
      />
      {mode === 'setup' ? (
        <AppInput
          value={confirmation}
          onChangeText={(next) => setConfirmation(next.replace(/\D/g, '').slice(0, 6))}
          placeholder={t('wallet.confirm_pin')}
          keyboardType="number-pad"
          secureTextEntry
          maxLength={6}
          invalid={confirmation.length > 0 && pin !== confirmation}
          description={t('wallet.pin_setup_hint')}
          error={invalid ? supportingText : undefined}
          onSubmitEditing={() => void submit()}
        />
      ) : null}
    </>
  );

  if (IS_ELECTRON) {
    return (
      <InputDialog
        visible={visible}
        onClose={close}
        onClosed={onClosed}
        actionLayout="vertical"
        confirmLabel={t(mode === 'setup' ? 'wallet.save_pin' : 'wallet.confirm_pin_action')}
        confirmLoading={submitting}
        confirmDisabled={!complete}
        onConfirm={() => void submit()}
      >
        <View style={{ gap: spacing.md }}>{fields}</View>
      </InputDialog>
    );
  }

  return (
    <BottomSheet
      visible={visible}
      onClose={close}
      onClosed={onClosed}
      inputFocusRef={pinInputRef}
      maxWidth={contentWidth.compactSheet}
      title={t(mode === 'setup' ? 'wallet.save_pin' : 'wallet.auth_prompt')}
    >
      <View style={{ gap: spacing.md }}>
        {fields}
        <ActionRow
          layout="vertical"
          confirm={{
            label: t(mode === 'setup' ? 'wallet.save_pin' : 'wallet.confirm_pin_action'),
            loading: submitting,
            disabled: !complete,
            onPress: () => void submit(),
          }}
        />
      </View>
    </BottomSheet>
  );
}
