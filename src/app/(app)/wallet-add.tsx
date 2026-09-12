import { router } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ScrollView, View } from 'react-native';

import { AppButton } from '@/components/common/AppButton';
import { AppInput } from '@/components/common/AppInput';
import { AppScreen } from '@/components/common/AppScreen';
import { QrScanButton } from '@/components/common/QrScanButton';
import { ScreenHeader, useScreenHeaderClearance } from '@/components/common/ScreenHeader';
import { platform } from '@/platform';
import { getProfile } from '@/services/profile/profile.service';
import { setWalletPin, walletAuthenticationMode } from '@/services/wallet/wallet-pin.service';
import { addWallet, validateWalletConnectionString } from '@/services/wallet/wallet.service';
import { useActiveAccount } from '@/stores/active-account.store';
import { useReceivingWalletPromptStore } from '@/stores/receiving-wallet-prompt.store';
import { useScrolled } from '@/hooks/use-scrolled';
import { spacing } from '@/theme';

export default function AddWalletScreen() {
  const { scrolled, scrollProps } = useScrolled();
  const { t } = useTranslation();
  const accountPubkey = useActiveAccount((s) => s.activePubkey);
  const [value, setValue] = useState('');
  const [saving, setSaving] = useState(false);
  const [step, setStep] = useState<'connection' | 'pin'>('connection');
  const [pendingConnection, setPendingConnection] = useState('');
  const [pin, setPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const titleClearance = useScreenHeaderClearance();

  async function submit(input = value) {
    if (!accountPubkey || saving) return;
    try {
      validateWalletConnectionString(input);
    } catch {
      void platform.confirmationDialog.notify({ title: t('wallet.connect_failed'), okLabel: t('common.ok') });
      return;
    }
    setSaving(true);
    try {
      if ((await walletAuthenticationMode(accountPubkey)) === 'pin_setup_required') {
        setPendingConnection(input);
        setStep('pin');
        return;
      }
      await connectWallet(input);
    } catch {
      void platform.confirmationDialog.notify({ title: t('wallet.connect_failed'), okLabel: t('common.ok') });
    } finally {
      setSaving(false);
    }
  }

  async function connectWallet(input: string) {
    if (!accountPubkey) return;
    const wallet = await addWallet(accountPubkey, input);
    const profile = wallet.lud16 ? await getProfile(accountPubkey).catch(() => null) : null;
    const profileAddress = profile?.lud16 || profile?.lud06 || '';
    if (wallet.lud16 && wallet.lud16 !== profileAddress) {
      useReceivingWalletPromptStore.getState().queue({
        accountPubkey,
        walletId: wallet.id,
        address: wallet.lud16,
      });
    }
    router.back();
  }

  async function savePinAndConnect() {
    if (!accountPubkey || saving || !/^\d{6}$/.test(pin) || pin !== confirmPin) return;
    setSaving(true);
    try {
      await setWalletPin(accountPubkey, pin);
      await connectWallet(pendingConnection);
    } catch {
      void platform.confirmationDialog.notify({ title: t('wallet.connect_failed'), okLabel: t('common.ok') });
    } finally {
      setSaving(false);
    }
  }

  function handleBack() {
    if (step === 'pin') {
      setStep('connection');
      setPin('');
      setConfirmPin('');
      return;
    }
    router.back();
  }

  return (
    <AppScreen edges={[]}>
      <ScrollView {...scrollProps} contentContainerStyle={{ padding: 16, paddingTop: titleClearance + 16, gap: 24 }}>
        {step === 'connection' ? (
          <>
            <AppInput
              description={t('wallet.add_hint')}
              value={value}
              onChangeText={setValue}
              autoCapitalize="none"
              autoCorrect={false}
              placeholder="nostr+walletconnect://..."
              trailingAccessory={
                <QrScanButton
                  onScanned={(data) => {
                    setValue(data);
                    void submit(data);
                  }}
                />
              }
            />
            <AppButton label={t('wallet.connect')} variant="primary" loading={saving} onPress={() => submit()} />
          </>
        ) : (
          <>
            <View style={{ gap: spacing.sm }}>
              <AppInput
                value={pin}
                onChangeText={(next) => setPin(next.replace(/\D/g, '').slice(0, 6))}
                placeholder={t('wallet.pin')}
                keyboardType="number-pad"
                secureTextEntry
                maxLength={6}
              />
              <AppInput
                value={confirmPin}
                onChangeText={(next) => setConfirmPin(next.replace(/\D/g, '').slice(0, 6))}
                placeholder={t('wallet.confirm_pin')}
                keyboardType="number-pad"
                secureTextEntry
                maxLength={6}
                invalid={confirmPin.length > 0 && pin !== confirmPin}
                description={t('wallet.pin_setup_hint')}
                onSubmitEditing={() => void savePinAndConnect()}
              />
            </View>
            <AppButton
              label={t('wallet.save_pin_and_connect')}
              variant="primary"
              loading={saving}
              disabled={!/^\d{6}$/.test(pin) || pin !== confirmPin}
              onPress={() => void savePinAndConnect()}
            />
          </>
        )}
      </ScrollView>
      <ScreenHeader bordered={scrolled} title={t('wallet.add')} onBack={handleBack} />
    </AppScreen>
  );
}
