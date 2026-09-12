import { router } from 'expo-router';
import { DirectionalChevron as ChevronRight } from '@/components/common/DirectionalChevron';
import { ChatRound as MessageCircle } from '@solar-icons/react-native/category/messages/Linear/ChatRound';
import { Copy } from '@solar-icons/react-native/category/ui/Linear/Copy';
import { KeySquare2 as FileKey2 } from '@solar-icons/react-native/category/security/Linear/KeySquare2';
import { useTranslation } from 'react-i18next';
import { ScrollView } from 'react-native';

import { AppButton } from '@/components/common/AppButton';
import { AppScreen } from '@/components/common/AppScreen';
import { ListGroup } from '@/components/common/ListGroup';
import { ListRow } from '@/components/common/ListRow';
import { ScreenHeader, useScreenHeaderClearance } from '@/components/common/ScreenHeader';
import { setStringAsync } from '@/lib/clipboard';
import { platform } from '@/platform';
import { exportIdentityNsec } from '@/services/signer/signer-factory';
import { useActiveAccount } from '@/stores/active-account.store';
import { useScrolled } from '@/hooks/use-scrolled';
import { spacing, useThemeColors } from '@/theme';

/**
 * Account hub — account-level security actions kept off the main Settings list:
 * copy the private key, manage encryption-key rotation, and remove the account.
 */
export default function AccountSettings() {
  const { scrolled, scrollProps } = useScrolled();
  const { t } = useTranslation();
  const c = useThemeColors();
  const titleClearance = useScreenHeaderClearance();
  const activePubkey = useActiveAccount((s) => s.activePubkey);
  const removeAccount = useActiveAccount((s) => s.removeAccount);

  function handleExportNsec() {
    void platform.confirmationDialog
      .confirm({
        title: t('settings.export_nsec_title'),
        message: t('settings.export_nsec_message'),
        cancelLabel: t('common.cancel'),
        confirmLabel: t('settings.export_nsec_confirm'),
        actionLayout: 'vertical',
      })
      .then((confirmed) => {
        if (confirmed) void doExportNsec();
      });
  }

  async function doExportNsec() {
    if (!activePubkey) return;
    const nsec = await exportIdentityNsec(activePubkey);
    if (!nsec) {
      await platform.confirmationDialog.notify({
        title: t('settings.export_nsec_failed'),
        okLabel: t('common.ok'),
      });
      return;
    }
    await setStringAsync(nsec);
    await platform.confirmationDialog.notify({
      title: t('settings.export_nsec_copied'),
      okLabel: t('common.ok'),
    });
  }

  // Removing is deliberately stronger than signing out: it wipes this account's
  // local data and key material, then returns to onboarding. Use the same
  // platform confirmation as the account switcher so Electron presents its
  // native message box instead of React Native Web's no-op Alert implementation.
  function handleRemoveAccount() {
    if (!activePubkey) return;
    void platform.confirmationDialog
      .confirm({
        title: t('account.remove_title'),
        message: t('account.remove_message'),
        cancelLabel: t('common.cancel'),
        confirmLabel: t('account.remove_confirm'),
        destructive: true,
      })
      .then((confirmed) => {
        if (confirmed) void removeAccount(activePubkey);
      });
  }

  return (
    <AppScreen edges={[]}>
      <ScrollView
        {...scrollProps}
        contentContainerStyle={{
          paddingHorizontal: spacing.lg,
          paddingTop: titleClearance + spacing.sm,
          paddingBottom: spacing['2xl'],
          gap: spacing.xl,
        }}
      >
        <ListGroup>
          <ListRow
            icon={<FileKey2 size={22} color={c.text} />}
            title={t('settings.export_nsec')}
            trailing={<Copy size={18} color={c.textMuted} />}
            onPress={handleExportNsec}
          />
          <ListRow
            icon={<MessageCircle size={22} color={c.text} />}
            title={t('key_rotation.title')}
            trailing={<ChevronRight size={18} color={c.textMuted} />}
            onPress={() => router.push('/encryption-key')}
          />
        </ListGroup>

        <AppButton label={t('account.remove')} variant="danger" onPress={handleRemoveAccount} />
      </ScrollView>
      <ScreenHeader bordered={scrolled} title={t('settings.account')} />
    </AppScreen>
  );
}
