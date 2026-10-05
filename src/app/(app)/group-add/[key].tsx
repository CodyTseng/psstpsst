import { router, useLocalSearchParams } from 'expo-router';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { KeyboardAvoidingView, View } from 'react-native';

import { AppButton } from '@/components/common/AppButton';
import { ChromeDivider } from '@/components/common/ChromeDivider';
import { AppInput } from '@/components/common/AppInput';
import { AppScreen } from '@/components/common/AppScreen';
import { InputClearButton } from '@/components/common/InputClearButton';
import { QrScanButton } from '@/components/common/QrScanButton';
import { ScreenHeader, useScreenHeaderClearance } from '@/components/common/ScreenHeader';
import { ContactSectionList } from '@/components/contacts/ContactSectionList';
import { ContactListItem } from '@/components/conversation/ContactListItem';
import { useContactEntries } from '@/hooks/use-contact-entries';
import { useContact } from '@/hooks/use-contacts';
import { useConversation } from '@/hooks/use-conversations';
import { useFocusAfterTransition } from '@/hooks/use-focus-after-transition';
import { useProfile } from '@/hooks/use-profile';
import { useScrolled } from '@/hooks/use-scrolled';
import { backSafely } from '@/lib/navigation';
import { LARGE_GROUP_WARNING_THRESHOLD } from '@/lib/group';
import { resolveDisplayName } from '@/lib/nostr/display-name';
import { abbreviateNpub } from '@/lib/nostr/format';
import { pubkeyToNpub } from '@/lib/nostr/keys';
import { KEYBOARD_AVOIDING_BEHAVIOR } from '@/lib/platform';
import { resolveNostrUserInput } from '@/lib/nostr/user-input';
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
  const [input, setInput] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [resolving, setResolving] = useState(false);
  const [resolvedPubkey, setResolvedPubkey] = useState<string | null>(null);
  const { t } = useTranslation();
  const clearance = useScreenHeaderClearance();
  const inputRef = useFocusAfterTransition();
  const { scrolled, scrollProps } = useScrolled();
  const members = useMemo(
    () => conversation?.memberPubkeys ?? [],
    [conversation?.memberPubkeys],
  );
  const memberSet = useMemo(() => new Set(members), [members]);
  const choices = useMemo(
    () => entries.filter((entry) => entry.pubkey !== accountPubkey && !memberSet.has(entry.pubkey)),
    [accountPubkey, entries, memberSet],
  );
  const resolvedProfile = useProfile(resolvedPubkey);
  const resolvedContact = useContact(accountPubkey, resolvedPubkey ?? '');
  const resolvedNpub = useMemo(
    () => resolvedPubkey ? abbreviateNpub(pubkeyToNpub(resolvedPubkey)) : '',
    [resolvedPubkey],
  );
  const resolvedName = resolvedPubkey
    ? resolveDisplayName(resolvedPubkey, {
        petname: resolvedContact?.petname,
        displayName: resolvedProfile?.displayName,
        name: resolvedProfile?.name,
      })
    : '';
  const resolvedSecondary = resolvedProfile?.nip05 || (
    resolvedName !== resolvedNpub ? resolvedNpub : null
  );

  async function invite(pubkey: string) {
    if (!conversation || busy) return;
    if (members.length + 1 > LARGE_GROUP_WARNING_THRESHOLD) {
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
      backSafely();
    } finally {
      setBusy(false);
    }
  }

  async function search(raw: string) {
    if (resolving || busy) return;
    setError(null);
    setResolvedPubkey(null);
    setResolving(true);
    try {
      const result = await resolveNostrUserInput(raw);
      if (result.status !== 'resolved') {
        setError(t(
          result.status === 'nip05_not_found'
            ? 'add_contact.nip05_not_found'
            : 'add_contact.invalid',
        ));
        return;
      }
      if (result.pubkey === accountPubkey || memberSet.has(result.pubkey)) {
        setError(t('group.member_already_added'));
        return;
      }
      setResolvedPubkey(result.pubkey);
    } finally {
      setResolving(false);
    }
  }

  function handleScanned(data: string) {
    setInput(data);
    void search(data);
  }

  return (
    <AppScreen edges={['bottom']}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={KEYBOARD_AVOIDING_BEHAVIOR}>
        {conversationLoaded && contactsLoaded ? (
          <>
            <View
              style={{
                paddingHorizontal: spacing.lg,
                paddingTop: clearance + spacing.sm,
                paddingBottom: spacing.md,
                gap: spacing.xl,
              }}
            >
              <AppInput
                ref={inputRef}
                placeholder={t('add_contact.placeholder')}
                description={t('group.add_member_search_hint')}
                value={input}
                onChangeText={(value) => {
                  setInput(value);
                  setResolvedPubkey(null);
                  if (error) setError(null);
                }}
                autoCapitalize="none"
                autoCorrect={false}
                error={error ?? undefined}
                returnKeyType="search"
                onSubmitEditing={() => {
                  if (input.trim()) void search(input);
                }}
                inputTrailingAccessory={input.length > 0 ? (
                  <InputClearButton
                    onPress={() => {
                      setInput('');
                      setError(null);
                      setResolvedPubkey(null);
                      inputRef.current?.focus();
                    }}
                  />
                ) : undefined}
                trailingAccessory={<QrScanButton onScanned={handleScanned} />}
              />
              <AppButton
                label={t('add_contact.add')}
                variant="primary"
                size="lg"
                loading={resolving}
                disabled={!input.trim() || busy}
                onPress={() => void search(input)}
              />
            </View>
            <View style={{ flex: 1 }}>
              {resolvedPubkey ? (
                <ContactListItem
                  counterpartyPubkey={resolvedPubkey}
                  displayName={resolvedName}
                  secondaryName={resolvedSecondary}
                  picture={resolvedProfile?.picture}
                  showSelfBadge={false}
                  trailing={(
                    <AppButton
                      label={t('group.add_member')}
                      variant="accentText"
                      size="sm"
                      labelVariant="caption"
                      fullWidth={false}
                      loading={busy}
                      onPress={(event) => {
                        event.stopPropagation();
                        void invite(resolvedPubkey);
                      }}
                    />
                  )}
                  onPress={() => router.push(
                    `/profile/${encodeURIComponent(resolvedPubkey)}`,
                  )}
                />
              ) : (
                <ContactSectionList
                  entries={choices}
                  onSelect={(pubkey) => void invite(pubkey)}
                  onScroll={scrollProps.onScroll}
                  contentBottomInset={spacing.lg}
                />
              )}
              <ChromeDivider visible={!resolvedPubkey && scrolled} edge="top" />
            </View>
          </>
        ) : (
          <View style={{ flex: 1, paddingTop: clearance }} />
        )}
      </KeyboardAvoidingView>
      <ScreenHeader title={t('group.add_member')} />
    </AppScreen>
  );
}
