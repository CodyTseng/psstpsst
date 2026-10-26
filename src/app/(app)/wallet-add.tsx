import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ScrollView } from 'react-native';

import { AppButton } from '@/components/common/AppButton';
import { AppInput } from '@/components/common/AppInput';
import { AppScreen } from '@/components/common/AppScreen';
import { QrScanButton } from '@/components/common/QrScanButton';
import { ScreenHeader, useScreenHeaderClearance } from '@/components/common/ScreenHeader';
import { useScrolled } from '@/hooks/use-scrolled';
import { backSafely } from '@/lib/navigation';
import { routeStringParam } from '@/lib/navigation/route-params';
import { platform } from '@/platform';
import { getProfile } from '@/services/profile/profile.service';
import { addWallet, validateWalletConnectionString, type WalletRow } from '@/services/wallet/wallet.service';
import { useActiveAccount } from '@/stores/active-account.store';
import { useReceivingWalletPromptStore } from '@/stores/receiving-wallet-prompt.store';
import { useWalletConnectionHandoffStore } from '@/stores/wallet-connection-handoff.store';
import { spacing } from '@/theme';

export default function AddWalletScreen() {
  const { scrolled, scrollProps } = useScrolled();
  const { t } = useTranslation();
  const params = useLocalSearchParams<{ handoff?: string | string[] }>();
  const handoffId = parseHandoffId(params.handoff);
  const accountPubkey = useActiveAccount((s) => s.activePubkey);
  const [value, setValue] = useState('');
  const [saving, setSaving] = useState(false);
  const titleClearance = useScreenHeaderClearance();

  const complete = useCallback(async (wallet: WalletRow) => {
    if (!accountPubkey) return;
    const profile = wallet.lud16 ? await getProfile(accountPubkey).catch(() => null) : null;
    const profileAddress = profile?.lud16 || profile?.lud06 || '';
    if (wallet.lud16 && wallet.lud16 !== profileAddress) {
      useReceivingWalletPromptStore.getState().queue({
        accountPubkey,
        walletId: wallet.id,
        address: wallet.lud16,
      });
    }
    router.dismissTo('/wallet');
  }, [accountPubkey]);

  const submit = useCallback(async (input = value) => {
    if (!accountPubkey || saving) return;
    try {
      validateWalletConnectionString(input);
    } catch {
      void platform.confirmationDialog.notify({ title: t('wallet.connect_failed'), okLabel: t('common.ok') });
      return;
    }
    setSaving(true);
    try {
      const work = addWallet(accountPubkey, input);
      setValue('');
      input = '';
      await complete(await work);
    } catch {
      void platform.confirmationDialog.notify({ title: t('wallet.connect_failed'), okLabel: t('common.ok') });
    } finally {
      setSaving(false);
    }
  }, [accountPubkey, complete, saving, t, value]);

  useEffect(() => {
    if (!accountPubkey || handoffId == null) return;
    const timer = setTimeout(() => {
      const connectionString = useWalletConnectionHandoffStore
        .getState()
        .consume(handoffId, accountPubkey);
      if (!connectionString) return;
      void submit(connectionString);
    }, 0);
    return () => clearTimeout(timer);
  }, [accountPubkey, handoffId, submit]);


  return (
    <AppScreen edges={[]}>
      <ScrollView {...scrollProps} contentContainerStyle={{ padding: spacing.lg, paddingTop: titleClearance + spacing.lg, gap: spacing.xl }}>
        <AppInput description={t('wallet.add_hint')} value={value} onChangeText={setValue}
          autoCapitalize="none" autoCorrect={false} secureTextEntry editable={!saving}
          placeholder="nostr+walletconnect://..."
          trailingAccessory={<QrScanButton onScanned={data => { setValue(data); void submit(data); }} />} />
        <AppButton label={t('wallet.connect')} variant="primary" loading={saving} disabled={!value.trim()} onPress={() => submit()} />

      </ScrollView>
      <ScreenHeader bordered={scrolled} title={t('wallet.add')} onBack={backSafely} />
    </AppScreen>
  );
}

function parseHandoffId(value: string | string[] | undefined): number | null {
  const parsed = routeStringParam(value, 16);
  if (!parsed || !/^\d+$/.test(parsed)) return null;
  const id = Number(parsed);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}
