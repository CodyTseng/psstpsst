import { router, useLocalSearchParams } from 'expo-router';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { AppScreen } from '@/components/common/AppScreen';
import { ScreenHeader, useScreenHeaderClearance } from '@/components/common/ScreenHeader';
import { ContactSectionList } from '@/components/contacts/ContactSectionList';
import { useContactEntries } from '@/hooks/use-contact-entries';
import { useConversation } from '@/hooks/use-conversations';
import { platform } from '@/platform';
import { dmService } from '@/services/dm/dm.service';
import { groupService } from '@/services/group/group.service';
import { useActiveAccount } from '@/stores/active-account.store';
import { spacing } from '@/theme';

export default function GroupAddMemberScreen() {
  const params = useLocalSearchParams<{ key: string | string[] }>();
  const conversationKey = typeof params.key === 'string' ? params.key : '';
  const accountPubkey = useActiveAccount((state) => state.activePubkey) ?? '';
  const { conversation, loaded: conversationLoaded } = useConversation(
    accountPubkey,
    conversationKey,
  );
  const { entries, loaded: contactsLoaded } = useContactEntries(accountPubkey);
  const [busy, setBusy] = useState(false);
  const { t } = useTranslation();
  const clearance = useScreenHeaderClearance();
  const members = conversation?.memberPubkeys ?? [];
  const choices = useMemo(
    () => entries.filter((entry) => entry.pubkey !== accountPubkey && !members.includes(entry.pubkey)),
    [accountPubkey, entries, members],
  );

  async function invite(pubkey: string) {
    if (!conversation || busy) return;
    if (members.length + 1 > 8) {
      const confirmed = await platform.confirmationDialog.confirm({
        title: t('group.large_group_title'),
        message: t('group.large_group_message'),
        cancelLabel: t('common.cancel'),
        confirmLabel: t('common.ok'),
      });
      if (!confirmed) return;
    }
    setBusy(true);
    try {
      if (conversation.membersBootstrapEventId) {
        await dmService.sendGroupAction({
          accountPubkey,
          conversationKey,
          action: 'invite',
          memberPubkey: pubkey,
        });
      } else {
        await groupService.updateLocalRoster(accountPubkey, conversationKey, [...members, pubkey]);
      }
      router.back();
    } finally {
      setBusy(false);
    }
  }

  return (
    <AppScreen edges={['bottom']}>
      {conversationLoaded && contactsLoaded ? (
        <ContactSectionList
          entries={choices}
          onSelect={(pubkey) => void invite(pubkey)}
          contentBottomInset={spacing.lg}
          ListHeaderComponent={<View style={{ height: clearance }} />}
        />
      ) : (
        <View style={{ flex: 1, paddingTop: clearance }} />
      )}
      <ScreenHeader title={t('group.add_member')} />
    </AppScreen>
  );
}
