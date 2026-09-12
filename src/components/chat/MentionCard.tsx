import { router } from 'expo-router';
import { type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';

import { InteractivePressable as Pressable } from '@/components/common/InteractivePressable';

import { AppText } from '@/components/common/AppText';
import { Avatar } from '@/components/common/Avatar';
import { InteractionOverlay } from '@/components/common/InteractionOverlay';
import { useDisplayName } from '@/hooks/use-display-name';
import { abbreviateNpub } from '@/lib/nostr/format';
import { pubkeyToNpub } from '@/lib/nostr/keys';
import { radius, spacing, useThemeColors } from '@/theme';

import { MessageCardFooter } from './MessageCardFooter';

type Props = {
  /** Hex pubkey the sole `nostr:` mention decoded to. */
  pubkey: string;
  /** The in-bubble timestamp + delivery glyph (painted in the muted tone).
   * Omitted in a non-message preview (e.g. the share confirm sheet). */
  metaSlot?: ReactNode;
  /** When false, render a static, non-tappable preview (no profile navigation,
   * no pressed state) — for previewing the card before it's sent. */
  interactive?: boolean;
  loadRemote?: boolean;
};

/**
 * A message whose whole body is a single `nostr:` mention renders as a profile
 * **name card** (DESIGN §8) — its own bubble style, not the text bubble: a
 * neutral `surface` card (hairline border) with avatar + display name over a
 * NIP-05 / key line, then a footer line (a "view profile" hint, with the
 * timestamp on its right). Tapping anywhere opens the profile. Name resolution
 * is shared with `MentionText` (`useDisplayName`) so list and lifted copy match.
 * Also reused (with `interactive={false}`, no `metaSlot`) to preview the card in
 * the share flow before sending.
 */
export function MentionCard({ pubkey, metaSlot, interactive = true, loadRemote = true }: Props) {
  const { t } = useTranslation();
  const c = useThemeColors();
  const { name, profile } = useDisplayName(pubkey, loadRemote);
  const secondary = profile?.nip05 ?? abbreviateNpub(pubkeyToNpub(pubkey));

  const body = (
    <>
      {/* Identity: avatar + name over the NIP-05 / key line (tight). */}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md }}>
        <Avatar pubkey={pubkey} picture={loadRemote ? profile?.picture : undefined} size={48} />
        <View style={{ flex: 1, gap: 1 }}>
          <AppText variant="subtitle" weight="semibold" numberOfLines={1}>
            {name}
          </AppText>
          <AppText variant="caption" tone="muted" numberOfLines={1}>
            {secondary}
          </AppText>
        </View>
      </View>

      <MessageCardFooter
        leading={
          <AppText variant="caption" tone="muted" numberOfLines={1}>
            {t('chat.view_profile')}
          </AppText>
        }
        metaSlot={metaSlot}
      />
    </>
  );

  // Fixed, roomy width so every name card reads the same regardless of name
  // length (capped by the bubble's shared max width on a narrow screen). Top/sides
  // padding match (avatar sits symmetric); the bottom is tighter (6) so the time
  // clears the bottom border by the same gap as a text bubble.
  const base = {
    width: 260,
    maxWidth: '100%',
    paddingTop: 10,
    paddingHorizontal: 10,
    paddingBottom: 6,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: c.border,
  } as const;

  if (!interactive) {
    return <View style={[base, { backgroundColor: c.surface }]}>{body}</View>;
  }

  return (
    <Pressable
      disabled={!loadRemote}
      onPress={() => router.push(`/profile/${encodeURIComponent(pubkey)}`)}
      fallbackHoverOpacity={false}
      style={{ ...base, backgroundColor: c.surface }}
    >
      {({ pressed }) => (
        <>
          {pressed ? <InteractionOverlay borderRadius={radius.lg} /> : null}
          {body}
        </>
      )}
    </Pressable>
  );
}
