import Plus from 'lucide-react-native/icons/plus';
import { useCallback, useMemo, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { KeyboardAvoidingView, View } from 'react-native';
import { useSharedValue, withTiming } from 'react-native-reanimated';

import { ChromeDivider } from '@/components/common/ChromeDivider';
import { AppButton } from '@/components/common/AppButton';
import { AppInput } from '@/components/common/AppInput';
import { AppScreen } from '@/components/common/AppScreen';
import { ScreenHeader, useScreenHeaderClearance } from '@/components/common/ScreenHeader';
import { ContactSectionList } from '@/components/contacts/ContactSectionList';
import { ConversationRecipientList } from '@/components/share/ConversationRecipientList';
import { SelectedRecipientsRow } from '@/components/share/SelectedRecipientsRow';
import { ShareConfirmSheet } from '@/components/share/ShareConfirmSheet';
import { useScrolled } from '@/hooks/use-scrolled';
import { useContactEntries } from '@/hooks/use-contact-entries';
import { useMainInboxConversations } from '@/hooks/use-conversations';
import type { ConversationDeliveryKind } from '@/lib/conversation/capabilities';
import { parseNostrInput } from '@/lib/nostr/keys';
import { KEYBOARD_AVOIDING_BEHAVIOR } from '@/lib/platform';
import { shareTargetId, type ShareTarget } from '@/lib/share/share-target';
import { iconStrokeWidth } from '@/theme/icons';
import { spacing, useThemeColors } from '@/theme';

type Props = {
  accountPubkey: string;
  title: string;
  preview: ReactNode;
  supportedDeliveryKinds: ReadonlySet<ConversationDeliveryKind>;
  sending: boolean;
  onConfirm: (targets: ShareTarget[]) => void;
  excludedRelayPubkey?: string | null;
};

/**
 * Shared full-page destination picker for every `/forward` payload. Payload
 * preparation and sending stay with the caller; recipient selection, new-chat
 * addressing, multi-select, and confirmation have one interaction path.
 */
export function ForwardRecipientScreen({
  accountPubkey,
  title,
  preview,
  supportedDeliveryKinds,
  sending,
  onConfirm,
  excludedRelayPubkey = null,
}: Props) {
  const { t } = useTranslation();
  const c = useThemeColors();
  const titleClearance = useScreenHeaderClearance();
  const { conversations, loaded: conversationsLoaded } = useMainInboxConversations(accountPubkey);
  const { entries, loaded: contactsLoaded } = useContactEntries(accountPubkey);
  const [input, setInput] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Map<string, ShareTarget>>(new Map());
  const [multiSelect, setMultiSelect] = useState(false);
  const [creatingConversation, setCreatingConversation] = useState(false);
  const { scrolled, scrollProps } = useScrolled({ resetKey: creatingConversation });
  const [confirmOpen, setConfirmOpen] = useState(false);
  const selectProgress = useSharedValue(0);

  const contacts = useMemo(
    () =>
      excludedRelayPubkey
        ? entries.filter((entry) => entry.pubkey !== excludedRelayPubkey)
        : entries,
    [entries, excludedRelayPubkey],
  );
  const recipientConversations = useMemo(
    () =>
      conversations.filter(({ conversation }) => {
        if (!supportedDeliveryKinds.has(conversation.deliveryKind)) return false;
        return !(
          excludedRelayPubkey &&
          conversation.deliveryKind === 'relay' &&
          conversation.conversationKey === excludedRelayPubkey
        );
      }),
    [conversations, excludedRelayPubkey, supportedDeliveryKinds],
  );
  const selectedTargets = useMemo(
    () =>
      [...selected.values()].filter((target) => supportedDeliveryKinds.has(target.deliveryKind)),
    [selected, supportedDeliveryKinds],
  );
  const selectedIds = useMemo(
    () => new Set(selectedTargets.map(shareTargetId)),
    [selectedTargets],
  );
  const selectedRelayPubkeys = useMemo(
    () =>
      new Set(
        selectedTargets
          .filter((target) => target.deliveryKind === 'relay')
          .map((target) => target.conversationKey),
      ),
    [selectedTargets],
  );

  const toggle = useCallback((target: ShareTarget) => {
    const id = shareTargetId(target);
    setSelected((current) => {
      const next = new Map(current);
      if (next.has(id)) next.delete(id);
      else next.set(id, target);
      return next;
    });
  }, []);

  const removeSelected = useCallback((id: string) => {
    setSelected((current) => {
      const next = new Map(current);
      next.delete(id);
      return next;
    });
  }, []);

  const pick = useCallback(
    (target: ShareTarget) => {
      if (multiSelect) {
        toggle(target);
        setCreatingConversation(false);
        return;
      }
      setSelected(new Map([[shareTargetId(target), target]]));
      setConfirmOpen(true);
    },
    [multiSelect, toggle],
  );

  const pickContact = useCallback(
    (pubkey: string) => {
      const contact = contacts.find((entry) => entry.pubkey === pubkey);
      pick({
        conversationKey: pubkey,
        deliveryKind: 'relay',
        name: contact?.displayName ?? null,
      });
    },
    [contacts, pick],
  );

  const addPasted = useCallback(
    (raw: string) => {
      setError(null);
      try {
        const pubkey = parseNostrInput(raw);
        if (pubkey === excludedRelayPubkey) return;
        setInput('');
        pick({ conversationKey: pubkey, deliveryKind: 'relay', name: null });
      } catch {
        setError(t('new_chat.invalid_npub'));
      }
    },
    [excludedRelayPubkey, pick, t],
  );

  function enableMultiSelect() {
    setSelected(new Map());
    setMultiSelect(true);
    selectProgress.value = withTiming(1, { duration: 200 });
  }

  return (
    <AppScreen edges={[]}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={KEYBOARD_AVOIDING_BEHAVIOR}>
        <View style={{ height: titleClearance }} />
        {multiSelect ? (
          <SelectedRecipientsRow targets={selectedTargets} onRemove={removeSelected} />
        ) : null}

        {creatingConversation ? (
          <>
            <View
              style={{
                paddingHorizontal: spacing.lg,
                paddingTop: spacing.sm,
                paddingBottom: spacing.md,
                gap: spacing.sm,
              }}
            >
              <AppInput
                placeholder={t('new_chat.placeholder')}
                value={input}
                onChangeText={(value) => {
                  setInput(value);
                  if (error) setError(null);
                }}
                autoCapitalize="none"
                autoCorrect={false}
                error={error ?? undefined}
                returnKeyType="go"
                onSubmitEditing={() => {
                  if (input.trim()) addPasted(input);
                }}
              />
            </View>
            {contactsLoaded ? (
              <View style={{ flex: 1 }}>
                <ContactSectionList
                  {...scrollProps}
                  entries={contacts}
                  onSelect={pickContact}
                  selectedPubkeys={multiSelect ? selectedRelayPubkeys : undefined}
                  selectProgress={selectProgress}
                />
                <ChromeDivider visible={scrolled} edge="top" />
              </View>
            ) : (
              <View style={{ flex: 1 }} />
            )}
          </>
        ) : conversationsLoaded ? (
          <View style={{ flex: 1 }}>
            <ConversationRecipientList
              {...scrollProps}
              items={recipientConversations}
              onSelect={pick}
              selectedIds={multiSelect ? selectedIds : undefined}
              selectProgress={selectProgress}
              header={
                <View style={{ paddingHorizontal: spacing.lg, paddingVertical: spacing.md }}>
                  <AppButton
                    variant="secondary"
                    label={t('conversations.new_chat_action')}
                    iconLeft={<Plus strokeWidth={iconStrokeWidth.default} size={20} color={c.text} />}
                    onPress={() => setCreatingConversation(true)}
                  />
                </View>
              }
            />
            <ChromeDivider visible={scrolled} edge="top" />
          </View>
        ) : (
          <View style={{ flex: 1 }} />
        )}
      </KeyboardAvoidingView>

      <ScreenHeader
        title={creatingConversation ? t('new_chat.title') : title}
        onBack={creatingConversation ? () => setCreatingConversation(false) : undefined}
        right={
          creatingConversation && !multiSelect ? null : multiSelect ? (
            <AppButton
              variant="text"
              label={
                selectedTargets.length > 0
                  ? `${t('share.next')} (${selectedTargets.length})`
                  : t('share.next')
              }
              disabled={selectedTargets.length === 0}
              onPress={() => setConfirmOpen(true)}
            />
          ) : (
            <AppButton
              variant="text"
              label={t('share.multi_select')}
              onPress={enableMultiSelect}
            />
          )
        }
      />

      <ShareConfirmSheet
        visible={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        preview={preview}
        recipients={selectedTargets}
        sending={sending}
        onConfirm={() => onConfirm(selectedTargets)}
      />
    </AppScreen>
  );
}
