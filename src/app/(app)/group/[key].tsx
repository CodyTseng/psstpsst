import { router, useLocalSearchParams } from 'expo-router';
import LogOut from 'lucide-react-native/icons/log-out';
import Pencil from 'lucide-react-native/icons/pencil';
import UserPlus from 'lucide-react-native/icons/user-plus';
import { Bell } from '@solar-icons/react-native/category/notifications/Linear/Bell';
import { BellOff } from '@solar-icons/react-native/category/notifications/Linear/BellOff';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FlatList, View } from 'react-native';

import { AppScreen } from '@/components/common/AppScreen';
import { AppText } from '@/components/common/AppText';
import { GroupAvatar } from '@/components/common/GroupAvatar';
import { ListGroup } from '@/components/common/ListGroup';
import { ListRow } from '@/components/common/ListRow';
import { ScreenHeader, useScreenHeaderClearance } from '@/components/common/ScreenHeader';
import { SectionLabel } from '@/components/common/SectionLabel';
import { Toggle } from '@/components/common/Toggle';
import { GroupMemberRow } from '@/components/group/GroupMemberRow';
import { ProfileAction } from '@/components/profile/ProfileAction';
import { useConversation } from '@/hooks/use-conversations';
import { useIsGroupSaved } from '@/hooks/use-common-groups';
import { useGroupPresentation } from '@/hooks/use-group-presentation';
import { useScrolled } from '@/hooks/use-scrolled';
import { dmService } from '@/services/dm/dm.service';
import { groupService } from '@/services/group/group.service';
import { setGroupSaved } from '@/services/group/saved-groups.service';
import { setConversationMuted } from '@/services/conversation/conversation-prefs.service';
import { useActiveAccount } from '@/stores/active-account.store';
import { useDraftsStore } from '@/stores/drafts.store';
import { usePendingAttachmentsStore } from '@/stores/pending-attachments.store';
import { showToast } from '@/stores/toast.store';
import { iconStrokeWidth } from '@/theme/icons';
import { spacing, useThemeColors } from '@/theme';
import { platform } from '@/platform';

const GROUP_HERO_AVATAR_SIZE = 96;

export default function GroupInfoScreen() {
  const params = useLocalSearchParams<{ key: string | string[] }>();
  const conversationKey = typeof params.key === 'string' ? params.key : '';
  const accountPubkey = useActiveAccount((state) => state.activePubkey) ?? '';
  const { conversation, loaded } = useConversation(accountPubkey, conversationKey);
  const members = conversation?.memberPubkeys ?? [];
  const presentation = useGroupPresentation(accountPubkey, conversation?.name, members);
  const writable = members.includes(accountPubkey);
  const localOnly = !conversation?.membersBootstrapEventId;
  const { saved, loaded: savedLoaded } = useIsGroupSaved(
    accountPubkey,
    conversation?.groupId,
  );
  const [saving, setSaving] = useState(false);
  const { t } = useTranslation();
  const c = useThemeColors();
  const clearance = useScreenHeaderClearance();
  const { scrolled, scrollProps } = useScrolled();

  async function removeMember(pubkey: string) {
    const confirmed = await platform.confirmationDialog.confirm({
      title: t('group.remove_member'),
      message: t('group.remove_member_confirm'),
      cancelLabel: t('common.cancel'),
      confirmLabel: t('common.remove'),
      destructive: true,
    });
    if (!confirmed) return;
    if (localOnly) {
      await groupService.updateLocalRoster(
        accountPubkey,
        conversationKey,
        members.filter((member) => member !== pubkey),
      );
    } else {
      await dmService.sendGroupAction({
        accountPubkey,
        conversationKey,
        action: 'remove',
        memberPubkey: pubkey,
      });
    }
  }

  async function leave() {
    const confirmed = await platform.confirmationDialog.confirm({
      title: t('group.leave'),
      message: t('group.leave_confirm'),
      cancelLabel: t('common.cancel'),
      confirmLabel: t('group.leave'),
      destructive: true,
    });
    if (!confirmed) return;
    if (localOnly) {
      useDraftsStore.getState().clearDraft(conversationKey);
      for (const item of usePendingAttachmentsStore.getState().items) {
        if (item.accountPubkey === accountPubkey && item.conversationKey === conversationKey) {
          usePendingAttachmentsStore.getState().removeOne(item.tempId);
        }
      }
      router.dismissAll();
      router.replace('/');
      await groupService.abandonLocalGroup(accountPubkey, conversationKey);
      return;
    } else {
      await dmService.sendGroupAction({
        accountPubkey,
        conversationKey,
        action: 'remove',
        memberPubkey: accountPubkey,
      });
      if (conversation?.groupId) {
        try {
          await setGroupSaved(accountPubkey, conversation.groupId, false);
        } catch {
          showToast(t('group.save_failed'));
        }
      }
    }
    router.back();
  }

  async function toggleMute() {
    if (!conversation) return;
    await setConversationMuted(accountPubkey, conversationKey, !conversation.muted);
  }

  async function toggleSaved() {
    if (!conversation?.groupId || saving) return;
    setSaving(true);
    try {
      await setGroupSaved(accountPubkey, conversation.groupId, !saved);
    } catch {
      showToast(t('group.save_failed'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <AppScreen edges={['bottom']}>
      {!loaded || !conversation?.groupId ? (
        <View style={{ flex: 1, paddingTop: clearance + spacing.sm }} />
      ) : (
        <FlatList
          {...scrollProps}
          data={members}
          keyExtractor={(pubkey) => pubkey}
          contentContainerStyle={{
            paddingTop: clearance + spacing.sm,
            paddingBottom: spacing['2xl'],
          }}
          ListHeaderComponent={
            <View>
              <View
                style={{
                  alignItems: 'center',
                  paddingHorizontal: spacing.lg,
                  paddingBottom: spacing['2xl'],
                }}
              >
                <GroupAvatar
                  members={presentation.avatarMembers}
                  size={GROUP_HERO_AVATAR_SIZE}
                />
                <AppText
                  variant="title"
                  numberOfLines={2}
                  align="center"
                  style={{ marginTop: spacing.md, maxWidth: '100%' }}
                >
                  {presentation.title}
                </AppText>
                <View
                  style={{
                    alignSelf: 'stretch',
                    flexDirection: 'row',
                    justifyContent: 'space-around',
                    marginTop: spacing.xl,
                  }}
                >
                  {writable ? (
                    <ProfileAction
                      icon={
                        <UserPlus
                          size={22}
                          color={c.text}
                          strokeWidth={iconStrokeWidth.default}
                        />
                      }
                      label={t('group.add_member')}
                      onPress={() =>
                        router.push(`/group-add/${encodeURIComponent(conversationKey)}`)
                      }
                    />
                  ) : null}
                  {writable ? (
                    <ProfileAction
                      icon={
                        <Pencil
                          size={22}
                          color={c.text}
                          strokeWidth={iconStrokeWidth.default}
                        />
                      }
                      label={t('group.rename')}
                      onPress={() =>
                        router.push(`/group-rename/${encodeURIComponent(conversationKey)}`)
                      }
                    />
                  ) : null}
                  <ProfileAction
                    icon={
                      conversation.muted ? (
                        <Bell size={22} color={c.text} />
                      ) : (
                        <BellOff size={22} color={c.text} />
                      )
                    }
                    label={conversation.muted ? t('profile.unmute') : t('profile.mute')}
                    onPress={() => void toggleMute()}
                  />
                  {writable ? (
                    <ProfileAction
                      icon={
                        <LogOut
                          size={22}
                          color={c.danger}
                          strokeWidth={iconStrokeWidth.default}
                        />
                      }
                      label={t('group.leave')}
                      tone="danger"
                      onPress={() => void leave()}
                    />
                  ) : null}
                </View>
                {!localOnly ? (
                  <ListGroup style={{ alignSelf: 'stretch', marginTop: spacing.xl }}>
                    <ListRow
                      title={t('group.save_to_contacts')}
                      trailing={
                        <Toggle
                          value={saved}
                          onValueChange={() => void toggleSaved()}
                          disabled={!savedLoaded || saving}
                        />
                      }
                    />
                  </ListGroup>
                ) : null}
                {!writable ? (
                  <AppText
                    variant="body"
                    tone="muted"
                    align="center"
                    style={{ marginTop: spacing.xl, maxWidth: '100%' }}
                  >
                    {t('group.read_only')}
                  </AppText>
                ) : null}
              </View>
              <View
                style={{
                  paddingHorizontal: spacing.lg,
                  paddingVertical: spacing.sm,
                }}
              >
                <SectionLabel weight="semibold">{t('group.members')}</SectionLabel>
              </View>
            </View>
          }
          renderItem={({ item }) => (
            <GroupMemberRow
              accountPubkey={accountPubkey}
              pubkey={item}
              removable={writable && item !== accountPubkey}
              removeLabel={t('group.remove_member')}
              onRemove={() => void removeMember(item)}
            />
          )}
        />
      )}
      <ScreenHeader bordered={scrolled} />
    </AppScreen>
  );
}
