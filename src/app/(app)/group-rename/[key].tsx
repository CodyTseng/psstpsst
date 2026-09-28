import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { AppButton } from '@/components/common/AppButton';
import { AppInput } from '@/components/common/AppInput';
import { AppScreen } from '@/components/common/AppScreen';
import { ScreenHeader, useScreenHeaderClearance } from '@/components/common/ScreenHeader';
import { useConversation } from '@/hooks/use-conversations';
import { dmService } from '@/services/dm/dm.service';
import { groupService } from '@/services/group/group.service';
import { useActiveAccount } from '@/stores/active-account.store';
import { spacing } from '@/theme';

export default function GroupRenameScreen() {
  const params = useLocalSearchParams<{ key: string | string[] }>();
  const conversationKey = typeof params.key === 'string' ? params.key : '';
  const accountPubkey = useActiveAccount((state) => state.activePubkey) ?? '';
  const { conversation, loaded } = useConversation(accountPubkey, conversationKey);
  const [name, setName] = useState('');
  const [initialized, setInitialized] = useState(false);
  const [busy, setBusy] = useState(false);
  const { t } = useTranslation();
  const clearance = useScreenHeaderClearance();

  useEffect(() => {
    if (!loaded || initialized) return;
    setName(conversation?.name ?? '');
    setInitialized(true);
  }, [conversation?.name, initialized, loaded]);

  const normalized = name.trim();
  const valid = [...normalized].length <= 80;
  async function save() {
    if (!conversation || !valid || busy) return;
    setBusy(true);
    try {
      if (conversation.membersBootstrapEventId) {
        await dmService.sendGroupAction({
          accountPubkey,
          conversationKey,
          action: 'rename',
          name: normalized || null,
        });
      } else {
        await groupService.renameLocalGroup(accountPubkey, conversationKey, normalized || null);
      }
      router.back();
    } finally {
      setBusy(false);
    }
  }

  return (
    <AppScreen edges={['bottom']}>
      <View style={{ paddingTop: clearance + spacing.sm, paddingHorizontal: spacing.lg, gap: spacing.xl }}>
        <AppInput
          label={t('group.rename')}
          value={name}
          onChangeText={setName}
          maxLength={160}
          error={valid ? undefined : t('group.name_too_long')}
        />
        <AppButton
          label={t('common.save')}
          loading={busy}
          disabled={!loaded || !valid}
          onPress={() => void save()}
        />
      </View>
      <ScreenHeader title={t('group.rename')} />
    </AppScreen>
  );
}
