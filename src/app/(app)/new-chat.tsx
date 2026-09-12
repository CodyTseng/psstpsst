import { router } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { KeyboardAvoidingView, View } from 'react-native';

import { ChromeDivider } from '@/components/common/ChromeDivider';
import { AppButton } from '@/components/common/AppButton';
import { AppInput } from '@/components/common/AppInput';
import { AppScreen } from '@/components/common/AppScreen';
import { QrScanButton } from '@/components/common/QrScanButton';
import { ScreenHeader, useScreenHeaderClearance } from '@/components/common/ScreenHeader';
import { ContactSectionList } from '@/components/contacts/ContactSectionList';
import { useScrolled } from '@/hooks/use-scrolled';
import { useContactEntries } from '@/hooks/use-contact-entries';
import { KEYBOARD_AVOIDING_BEHAVIOR } from '@/lib/platform';
import { resolveNostrUserInput } from '@/lib/nostr/user-input';
import { useActiveAccount } from '@/stores/active-account.store';
import { spacing } from '@/theme';

export default function NewChat() {
  const { scrolled, scrollProps } = useScrolled();
  const { t } = useTranslation();
  const accountPubkey = useActiveAccount((s) => s.activePubkey);
  // The same localized contact index as the Contacts tab — tap a contact to skip the
  // paste box and open the chat straight away.
  const { entries, loaded } = useContactEntries(accountPubkey);
  const titleClearance = useScreenHeaderClearance();

  const [input, setInput] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

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
    if (loading) return;
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

  return (
    <AppScreen edges={['bottom']}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={KEYBOARD_AVOIDING_BEHAVIOR}
      >
        {/* Identifier search for reaching someone who isn't a contact. Keep the
            Start button visible but disabled at rest, matching Search user. */}
        <View
          style={{
            paddingHorizontal: spacing.lg,
            paddingTop: titleClearance + spacing.sm,
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
            label={t('new_chat.start')}
            variant="primary"
            size="lg"
            loading={loading}
            disabled={!input.trim()}
            onPress={() => void start(input)}
          />
        </View>

        {loaded ? (
          <View style={{ flex: 1 }}>
            <ContactSectionList
              {...scrollProps}
              entries={entries}
              onSelect={openConversation}
            />
            <ChromeDivider visible={scrolled} edge="top" />
          </View>
        ) : (
          <View style={{ flex: 1 }} />
        )}
      </KeyboardAvoidingView>
      <ScreenHeader title={t('new_chat.title')} />
    </AppScreen>
  );
}
