import { useMemo } from 'react';
import { View } from 'react-native';

import { InteractivePressable as Pressable } from '@/components/common/InteractivePressable';

import { AppText } from '@/components/common/AppText';
import { Avatar } from '@/components/common/Avatar';
import { SNIPPET_CLOSE, SNIPPET_OPEN } from '@/hooks/use-message-search';
import { useContact } from '@/hooks/use-contacts';
import { useProfile } from '@/hooks/use-profile';
import { resolveDisplayName } from '@/lib/nostr/display-name';
import { formatListTime } from '@/lib/time';
import { useActiveAccount } from '@/stores/active-account.store';
import { spacing, uiDensity, useThemeColors } from '@/theme';

type Props = {
  counterpartyPubkey: string | null;
  /** Sender identity for a message hit. Conversation hits use the counterparty. */
  avatarPubkey?: string | null;
  /** Conversation subject, if any (otherwise resolved from the counterparty). */
  conversationName: string | null;
  /** Second line: a last-message preview (conversation hit) or a message
   * snippet. When `boldSnippet`, runs wrapped in SNIPPET_OPEN/CLOSE render bold
   * accent (the matched term). */
  subtitle: string | null;
  boldSnippet?: boolean;
  timestamp: number;
  onPress: () => void;
  identityKind?: 'relay' | 'proximity';
};

/** Split a snippet into plain / matched runs on the STX/ETX sentinels. */
function splitSnippet(text: string): { text: string; hit: boolean }[] {
  const parts: { text: string; hit: boolean }[] = [];
  let buf = '';
  let hit = false;
  for (const ch of text) {
    if (ch === SNIPPET_OPEN) {
      if (buf) parts.push({ text: buf, hit });
      buf = '';
      hit = true;
    } else if (ch === SNIPPET_CLOSE) {
      if (buf) parts.push({ text: buf, hit });
      buf = '';
      hit = false;
    } else {
      buf += ch;
    }
  }
  if (buf) parts.push({ text: buf, hit });
  return parts;
}

/**
 * One result row, shared by the search surfaces. Conversation hits retain the
 * compact avatar + name + one-line preview, while message hits use the actual
 * sender's avatar and a wider matched excerpt. No swipe actions (unlike the
 * inbox `ConversationListItem`): a search result is purely a tap target.
 */
export function SearchResultRow({
  counterpartyPubkey,
  avatarPubkey,
  conversationName,
  subtitle,
  boldSnippet,
  timestamp,
  onPress,
  identityKind = 'relay',
}: Props) {
  const c = useThemeColors();
  const accountPubkey = useActiveAccount((s) => s.activePubkey) ?? '';
  const resolvedAvatarPubkey = avatarPubkey ?? counterpartyPubkey;
  const avatarUsesCounterparty = resolvedAvatarPubkey === counterpartyPubkey;
  const counterpartyRelayPubkey = identityKind === 'relay' ? counterpartyPubkey : null;
  const avatarRelayPubkey =
    identityKind === 'relay' && !avatarUsesCounterparty
      ? resolvedAvatarPubkey
      : null;
  const counterpartyProfile = useProfile(counterpartyRelayPubkey);
  const counterpartyContact = useContact(accountPubkey, counterpartyRelayPubkey ?? '');
  const avatarProfile = useProfile(avatarRelayPubkey);
  const avatarContact = useContact(accountPubkey, avatarRelayPubkey ?? '');

  const displayName =
    conversationName ||
    resolveDisplayName(counterpartyPubkey ?? '', {
      petname: counterpartyContact?.petname,
      displayName: counterpartyProfile?.displayName,
      name: counterpartyProfile?.name,
    });
  const resolvedAvatarProfile = avatarUsesCounterparty
    ? counterpartyProfile
    : avatarProfile;
  const resolvedAvatarContact = avatarUsesCounterparty
    ? counterpartyContact
    : avatarContact;
  const avatarName = resolveDisplayName(resolvedAvatarPubkey ?? '', {
    petname: resolvedAvatarContact?.petname,
    displayName: resolvedAvatarProfile?.displayName,
    name: resolvedAvatarProfile?.name,
  });

  const parts = useMemo(
    () => (boldSnippet && subtitle ? splitSnippet(subtitle) : null),
    [boldSnippet, subtitle],
  );

  return (
    <Pressable
      onPress={onPress}
      pressFeedback="delayed"
      style={({ pressed }) => ({
        height: uiDensity.contactRowHeight,
        paddingHorizontal: spacing.lg,
        flexDirection: 'row',
        alignItems: 'center',
        gap: spacing.md,
        backgroundColor: pressed ? c.interactionOverlay : 'transparent',
      })}
    >
      <Avatar
        pubkey={resolvedAvatarPubkey ?? '0'.repeat(64)}
        picture={resolvedAvatarProfile?.picture}
        name={avatarName}
        size={uiDensity.contactAvatarSize}
      />
      <View style={{ flex: 1 }}>
        <AppText variant="subtitle" numberOfLines={1}>
          {displayName}
        </AppText>
        {subtitle ? (
          <AppText variant="caption" tone="muted" numberOfLines={1}>
            {parts
              ? parts.map((p, i) =>
                  p.hit ? (
                    <AppText key={i} variant="caption" tone="accent" weight="semibold">
                      {p.text}
                    </AppText>
                  ) : (
                    p.text
                  ),
                )
              : subtitle}
          </AppText>
        ) : null}
      </View>
      <AppText variant="caption" tone="subtle">
        {formatListTime(timestamp)}
      </AppText>
    </Pressable>
  );
}
