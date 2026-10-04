import { router } from 'expo-router';
import { UsersGroupRounded as UsersGroup } from '@solar-icons/react-native/category/users/Linear/UsersGroupRounded';
import { useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import { useSharedValue } from 'react-native-reanimated';

import { ActionRow } from '@/components/common/ActionRow';
import { AppScreen } from '@/components/common/AppScreen';
import { AppText } from '@/components/common/AppText';
import { ScreenHeader, useScreenHeaderClearance } from '@/components/common/ScreenHeader';
import { ContactSectionList } from '@/components/contacts/ContactSectionList';
import { useContactEntries } from '@/hooks/use-contact-entries';
import { useScrolled } from '@/hooks/use-scrolled';
import { LARGE_GROUP_WARNING_THRESHOLD } from '@/lib/group';
import { platform } from '@/platform';
import { groupService } from '@/services/group/group.service';
import { useActiveAccount } from '@/stores/active-account.store';
import { spacing, uiDensity, useThemeColors } from '@/theme';

export default function NewGroup() {
  const { t } = useTranslation();
  const c = useThemeColors();
  const accountPubkey = useActiveAccount((s) => s.activePubkey);
  const { entries: contactEntries, loaded } = useContactEntries(accountPubkey);
  const entries = useMemo(
    () => contactEntries.filter((entry) => entry.pubkey !== accountPubkey),
    [accountPubkey, contactEntries],
  );
  const titleClearance = useScreenHeaderClearance();
  const { scrolled, scrollProps } = useScrolled();
  const [loading, setLoading] = useState(false);
  const [confirmingSelection, setConfirmingSelection] = useState(false);
  const selectionConfirmationPending = useRef(false);
  const largeGroupWarningConfirmed = useRef(false);
  const [selectedPubkeys, setSelectedPubkeys] = useState<Set<string>>(() => new Set());
  const selectProgress = useSharedValue(1);

  async function toggleSelected(pubkey: string) {
    if (loading || selectionConfirmationPending.current) return;
    const crossingWarningThreshold =
      !largeGroupWarningConfirmed.current &&
      !selectedPubkeys.has(pubkey) &&
      selectedPubkeys.size + 1 <= LARGE_GROUP_WARNING_THRESHOLD &&
      selectedPubkeys.size + 2 > LARGE_GROUP_WARNING_THRESHOLD;
    if (crossingWarningThreshold) {
      selectionConfirmationPending.current = true;
      setConfirmingSelection(true);
      try {
        const confirmed = await platform.confirmationDialog.confirm({
          title: t('group.large_group_title'),
          message: t('group.large_group_message'),
          cancelLabel: t('common.cancel'),
          confirmLabel: t('common.ok'),
        });
        if (!confirmed) return;
        largeGroupWarningConfirmed.current = true;
      } finally {
        selectionConfirmationPending.current = false;
        setConfirmingSelection(false);
      }
    }
    setSelectedPubkeys((previous) => {
      const next = new Set(previous);
      if (next.has(pubkey)) next.delete(pubkey);
      else next.add(pubkey);
      return next;
    });
  }

  async function createGroup() {
    if (
      !accountPubkey || loading || selectionConfirmationPending.current || selectedPubkeys.size < 2
    ) return;
    setLoading(true);
    try {
      const group = await groupService.createLocalGroup(accountPubkey, [...selectedPubkeys]);
      router.replace(`/chat/${encodeURIComponent(group.conversationKey)}`);
    } finally {
      setLoading(false);
    }
  }

  return (
    <AppScreen edges={['bottom']}>
      <View style={{ flex: 1, paddingTop: titleClearance }}>
        {loaded ? (
          entries.length > 0 ? (
            <ContactSectionList
              {...scrollProps}
              entries={entries}
              onSelect={(pubkey) => void toggleSelected(pubkey)}
              selectedPubkeys={selectedPubkeys}
              selectProgress={selectProgress}
              ListHeaderComponent={
                <View
                  style={{
                    paddingHorizontal: spacing.lg,
                    paddingTop: spacing.sm,
                    paddingBottom: spacing.md,
                  }}
                >
                  <AppText tone="muted">{t('group.create_hint')}</AppText>
                </View>
              }
            />
          ) : (
            <View
              style={{
                flex: 1,
                alignItems: 'center',
                justifyContent: 'center',
                padding: spacing.xl,
                gap: spacing.md,
              }}
            >
              <UsersGroup size={uiDensity.contactAvatarSize} color={c.textMuted} />
              <AppText variant="subtitle" tone="muted" align="center">
                {t('contacts.empty_title')}
              </AppText>
              <AppText tone="muted" align="center">{t('group.create_hint')}</AppText>
            </View>
          )
        ) : (
          <View style={{ flex: 1 }} />
        )}
        <View
          style={{
            flexShrink: 0,
            padding: spacing.lg,
            borderTopWidth: StyleSheet.hairlineWidth,
            borderTopColor: c.border,
          }}
        >
          <ActionRow
            layout="vertical"
            confirm={{
              label: t('group.create_with_count', { count: selectedPubkeys.size }),
              loading,
              disabled: confirmingSelection || selectedPubkeys.size < 2,
              onPress: () => void createGroup(),
            }}
          />
        </View>
      </View>
      <ScreenHeader title={t('group.create_title')} bordered={scrolled} />
    </AppScreen>
  );
}
