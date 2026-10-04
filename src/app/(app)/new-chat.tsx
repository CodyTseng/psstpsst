import { router } from 'expo-router';
import { useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { KeyboardAvoidingView, View } from 'react-native';
import { useSharedValue } from 'react-native-reanimated';

import { AppButton } from '@/components/common/AppButton';
import { AppInput } from '@/components/common/AppInput';
import { AppScreen } from '@/components/common/AppScreen';
import { QrScanButton } from '@/components/common/QrScanButton';
import { ScreenHeader, useScreenHeaderClearance } from '@/components/common/ScreenHeader';
import { ContactSectionList } from '@/components/contacts/ContactSectionList';
import { useScrolled } from '@/hooks/use-scrolled';
import { useContactEntries } from '@/hooks/use-contact-entries';
import { LARGE_GROUP_WARNING_THRESHOLD } from '@/lib/group';
import { KEYBOARD_AVOIDING_BEHAVIOR } from '@/lib/platform';
import { resolveNostrUserInput } from '@/lib/nostr/user-input';
import { useActiveAccount } from '@/stores/active-account.store';
import { groupService } from '@/services/group/group.service';
import { platform } from '@/platform';
import { spacing } from '@/theme';

export default function NewChat() {
  const { scrolled, scrollProps } = useScrolled();
  const { t } = useTranslation();
  const accountPubkey = useActiveAccount((s) => s.activePubkey);
  // The same localized contact index as the Contacts tab — tap a contact to skip the
  // paste box and open the chat straight away.
  const { entries: contactEntries, loaded } = useContactEntries(accountPubkey);
  const entries = useMemo(
    () => contactEntries.filter((entry) => entry.pubkey !== accountPubkey),
    [accountPubkey, contactEntries],
  );
  const titleClearance = useScreenHeaderClearance();

  const [input, setInput] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [confirmingSelection, setConfirmingSelection] = useState(false);
  const selectionConfirmationPending = useRef(false);
  const largeGroupWarningConfirmed = useRef(false);
  const [selectedPubkeys, setSelectedPubkeys] = useState<Set<string>>(() => new Set());
  const selectProgress = useSharedValue(1);

  // Open (replace, so Back skips this picker) the 1:1 conversation with a
  // recipient pubkey. We don't pre-check DM support here: that's a slow
  // multi-relay lookup, and the chat screen already runs it (useDmSupport) with a
  // proper "checking" gate and a recheck affordance. Blocking before navigating
  // only adds a dead wait.
  function openConversation(recipient: string) {
    if (!accountPubkey) return;
    // Self is allowed — your own key opens your note-to-self chat (the
    // conversation_key is just the recipient pubkey, self included).
    router.replace(`/chat/${encodeURIComponent(recipient)}`);
  }

  // Resolve the same public-key and NIP-05 inputs as user search, then open the
  // conversation. Public keys stay local; only NIP-05 performs network work.
  async function start(raw: string) {
    if (loading || selectionConfirmationPending.current) return;
    setError(null);
    setLoading(true);
    try {
      const result = await resolveNostrUserInput(raw);
      if (result.status === 'resolved') {
        openConversation(result.pubkey);
      } else {
        setError(
          t(
            result.status === 'nip05_not_found'
              ? 'add_contact.nip05_not_found'
              : 'add_contact.invalid',
          ),
        );
      }
    } finally {
      setLoading(false);
    }
  }

  function handleScanned(data: string) {
    setInput(data);
    void start(data);
  }

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

  async function startSelected() {
    if (
      !accountPubkey || loading || selectionConfirmationPending.current || selectedPubkeys.size === 0
    ) return;
    if (selectedPubkeys.size === 1) {
      openConversation([...selectedPubkeys][0]);
      return;
    }
    setLoading(true);
    try {
      const group = await groupService.createLocalGroup(accountPubkey, [...selectedPubkeys]);
      router.replace(`/chat/${encodeURIComponent(group.conversationKey)}`);
    } finally {
      setLoading(false);
    }
  }

  const listHeader = (
    <View
      style={{
        paddingHorizontal: spacing.lg,
        paddingTop: spacing.sm,
        paddingBottom: spacing.md,
        gap: spacing.xl,
      }}
    >
      <AppInput
        placeholder={t('add_contact.placeholder')}
        description={t('new_chat.subtitle')}
        value={input}
        onChangeText={(v) => {
          setInput(v);
          if (error) setError(null);
        }}
        autoCapitalize="none"
        autoCorrect={false}
        error={error ?? undefined}
        returnKeyType="go"
        onSubmitEditing={() => {
          if (input.trim()) void start(input);
        }}
        trailingAccessory={<QrScanButton onScanned={handleScanned} />}
      />
      <AppButton
        label={
          input.trim()
            ? t('new_chat.start')
            : selectedPubkeys.size >= 2
              ? t('group.create_with_count', { count: selectedPubkeys.size })
              : t('new_chat.start')
        }
        variant="primary"
        size="lg"
        loading={loading}
        disabled={confirmingSelection || (!input.trim() && selectedPubkeys.size === 0)}
        onPress={() => input.trim() ? void start(input) : void startSelected()}
      />
    </View>
  );

  return (
    <AppScreen edges={['bottom']}>
      <KeyboardAvoidingView
        style={{ flex: 1, paddingTop: titleClearance }}
        behavior={KEYBOARD_AVOIDING_BEHAVIOR}
      >
        {loaded ? (
          <ContactSectionList
            {...scrollProps}
            entries={entries}
            onSelect={(pubkey) => void toggleSelected(pubkey)}
            selectedPubkeys={selectedPubkeys}
            selectProgress={selectProgress}
            ListHeaderComponent={listHeader}
          />
        ) : (
          listHeader
        )}
      </KeyboardAvoidingView>
      <ScreenHeader title={t('new_chat.title')} bordered={scrolled} />
    </AppScreen>
  );
}
