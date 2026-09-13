import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TextInput } from 'react-native';

import { ActionRow } from '@/components/common/ActionRow';
import { AppInput } from '@/components/common/AppInput';
import { BottomSheet } from '@/components/common/BottomSheet';
import { DirectionalChevron } from '@/components/common/DirectionalChevron';
import { InputDialog } from '@/components/common/InputDialog';
import { ListRow } from '@/components/common/ListRow';
import { IS_ELECTRON } from '@/lib/platform';
import { renameWallet, type WalletRow } from '@/services/wallet/wallet.service';
import { spacing, useThemeColors } from '@/theme';

export function WalletNameRow({ wallet }: { wallet: WalletRow }) {
  const { t } = useTranslation();
  const c = useThemeColors();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();
  const savingRef = useRef(false);
  const inputRef = useRef<TextInput>(null);
  const displayName = wallet.customName || wallet.name;

  function close() {
    if (!savingRef.current) setOpen(false);
  }

  async function save() {
    if (savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    setError(undefined);
    try {
      await renameWallet(wallet.accountPubkey, wallet.id, name);
      setOpen(false);
    } catch {
      setError(t('wallet.update_failed'));
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }

  const input = (
    <AppInput
      ref={inputRef}
      accessibilityLabel={t('wallet.name')}
      value={name}
      onChangeText={(value) => {
        setName(value);
        setError(undefined);
      }}
      placeholder={wallet.name}
      error={error}
      editable={!saving}
      autoFocus={IS_ELECTRON}
      autoCorrect={false}
      returnKeyType="done"
      onSubmitEditing={() => void save()}
    />
  );

  return (
    <>
      <ListRow
        title={t('wallet.name')}
        value={displayName}
        valueMultiline
        trailing={<DirectionalChevron size={18} color={c.textMuted} />}
        onPress={() => {
          setName(displayName);
          setError(undefined);
          setOpen(true);
        }}
      />
      {IS_ELECTRON ? (
        <InputDialog
          visible={open}
          onClose={close}
          title={t('wallet.rename')}
          actionLayout="horizontal"
          cancelLabel={t('common.cancel')}
          confirmLabel={t('wallet.save_name')}
          confirmLoading={saving}
          onConfirm={() => void save()}
        >
          {input}
        </InputDialog>
      ) : (
        <BottomSheet
          visible={open}
          onClose={close}
          title={t('wallet.rename')}
          inputFocusRef={inputRef}
          contentStyle={{ gap: spacing.lg }}
        >
          {input}
          <ActionRow
            layout="horizontal"
            dismiss={{ label: t('common.cancel'), onPress: close, disabled: saving }}
            confirm={{ label: t('wallet.save_name'), onPress: save, loading: saving }}
          />
        </BottomSheet>
      )}
    </>
  );
}
