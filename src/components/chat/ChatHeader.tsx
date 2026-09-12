import { router } from 'expo-router';
import ChevronLeft from 'lucide-react-native/icons/chevron-left';
import { StyleSheet, View } from 'react-native';

import { InteractivePressable as Pressable } from '@/components/common/InteractivePressable';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Avatar } from '@/components/common/Avatar';
import { AppButton } from '@/components/common/AppButton';
import { AppText } from '@/components/common/AppText';
import { CountBadge } from '@/components/common/CountBadge';
import { ChromeBackdrop } from '@/components/common/ChromeBackdrop';
import { SelfBadge } from '@/components/common/SelfBadge';
import { useContact } from '@/hooks/use-contacts';
import { useTotalUnread } from '@/hooks/use-conversations';
import { useProfile } from '@/hooks/use-profile';
import { useDirectionalIconStyle } from '@/i18n/direction';
import { resolveDisplayName } from '@/lib/nostr/display-name';
import { useActiveAccount } from '@/stores/active-account.store';
import type { NearbyConnectionStatus } from '@/stores/proximity.store';
import { useTranslation } from 'react-i18next';
import { iconStrokeWidth } from '@/theme/icons';
import { headerHeight, spacing, uiDensity, useThemeColors } from '@/theme';

const HEADER_AVATAR_SIZE = 32;

type Props = {
  counterpartyPubkey: string | null;
  fallbackName?: string;
  /** Optional in-memory picture used instead of a live profile picture. */
  pictureOverride?: string | number | null;
  proximityConnectionStatus?: NearbyConnectionStatus;
  proximityNickname?: string | null;
  proximityDisplayName?: string | null;
  identityKind?: 'relay' | 'proximity';
  liveDataEnabled?: boolean;
  /** Fixture-only override for the back badge while live reads are disabled. */
  otherUnreadOverride?: number;
};

export function ChatHeader({
  counterpartyPubkey,
  fallbackName,
  pictureOverride,
  proximityConnectionStatus,
  proximityNickname,
  proximityDisplayName,
  identityKind = 'relay',
  liveDataEnabled = true,
  otherUnreadOverride,
}: Props) {
  const c = useThemeColors();
  const directionalIconStyle = useDirectionalIconStyle();
  const insets = useSafeAreaInsets();
  const { t } = useTranslation();
  const accountPubkey = useActiveAccount((s) => s.activePubkey) ?? '';
  // The note-to-self conversation is a 1:1 with yourself — show your own name,
  // resolved like any peer (the `SelfBadge` below marks that it's genuinely you).
  const isSelf =
    identityKind === 'relay' &&
    !!counterpartyPubkey &&
    counterpartyPubkey === accountPubkey;
  const relayPubkey = identityKind === 'relay' ? counterpartyPubkey : null;
  const profile = useProfile(relayPubkey, liveDataEnabled);
  // Private petname (1:1 alias) wins over the published name, like everywhere else.
  const contact = useContact(accountPubkey, relayPubkey ?? '', liveDataEnabled);
  // Unread across *other* conversations — the open one is excluded from the
  // total while viewed (and marked read on open), so it contributes 0. Same
  // figure as the Chats-tab badge, shown next to Back so you can see other
  // threads are waiting without leaving.
  const liveOtherUnread = useTotalUnread(accountPubkey, liveDataEnabled);
  const otherUnread = otherUnreadOverride ?? liveOtherUnread;

  const name = resolveDisplayName(
    counterpartyPubkey ?? '',
    identityKind === 'relay'
      ? { petname: contact?.petname, displayName: profile?.displayName, name: profile?.name }
      : {
          petname: proximityNickname,
          displayName: proximityDisplayName,
        },
    fallbackName || undefined,
  );

  function openDetails() {
    if (!counterpartyPubkey) return;
    if (identityKind === 'proximity') {
      router.push({
        pathname: '/nearby-contact/[pubkey]',
        params: { pubkey: counterpartyPubkey, name },
      });
      return;
    }
    // `chat=1` marks the conversation context, so even note-to-self lands on
    // the conversation-detail peer view (search / media …) rather than the
    // own-profile edit hub.
    router.push(`/profile/${encodeURIComponent(counterpartyPubkey)}?chat=1`);
  }

  return (
    // iOS-style title bar: the title is absolutely centered (true screen center,
    // independent of how wide the back/avatar accessories are), with the
    // accessories on a row above it. `box-none` lets taps fall through the title
    // layer to the accessories except on the title text itself.
    <View
      style={{
        height: headerHeight + insets.top,
        justifyContent: 'center',
        paddingTop: insets.top,
        position: 'absolute',
        top: 0,
        start: 0,
        end: 0,
        zIndex: 1,
        // Hairline, matching ScreenHeader's bottom border (a plain 1px read
        // thicker than the tab/pushed headers' hairline).
        borderBottomWidth: StyleSheet.hairlineWidth,
        borderBottomColor: c.border,
      }}
    >
      <ChromeBackdrop scrollbarOcclusion="top" />
      <View
        style={{
          position: 'absolute',
          top: insets.top,
          left: 0,
          right: 0,
          bottom: 0,
          alignItems: 'center',
          justifyContent: 'center',
          // Keep the centered title clear of the side accessories.
          paddingHorizontal: 72,
          pointerEvents: 'box-none',
        }}
      >
        <Pressable
          onPress={openDetails}
          disabled={!counterpartyPubkey}
          hitSlop={6}
          style={{ maxWidth: '100%' }}
        >
          <View style={{ maxWidth: '100%', alignItems: 'center', gap: 2 }}>
            <AppText
              variant="subtitle"
              weight="semibold"
              numberOfLines={1}
              style={{ maxWidth: '100%', userSelect: 'none' }}
            >
              {name}
            </AppText>
            {proximityConnectionStatus ? (
              <AppText
                variant="caption"
                tone="muted"
                style={[
                  { userSelect: 'none' },
                  proximityConnectionStatus === 'connected' ? { color: c.success } : undefined,
                ]}
              >
                {proximityConnectionStatus === 'connected'
                  ? t('nearby.list_connected')
                  : proximityConnectionStatus === 'connecting'
                    ? t('nearby.connecting')
                    : t('nearby.disconnected')}
              </AppText>
            ) : null}
            {isSelf ? <SelfBadge style={{ alignSelf: 'center' }} /> : null}
          </View>
        </Pressable>
      </View>

      <View
        style={{
          position: 'absolute',
          top: insets.top,
          bottom: 0,
          start: 0,
          end: 0,
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          // Align accessories to the 16px content gutter used below (message
          // bubbles). Both platform controls sit on the 8px header rail. Back
          // carries a compact inset; the 32px avatar adds the remaining logical end inset,
          // so both visible accessories land on the 16px content gutter.
          paddingStart: spacing.sm,
          paddingEnd: spacing.sm,
          pointerEvents: 'box-none',
        }}
      >
        {/* Back chevron + the other-conversations unread count form one tap target
            (a content-hugging ghost pill) — tapping the count goes back too. The
            chevron is the normal text color (iOS back is the text tint, not grey);
            the count is the `neutralStrong` badge — a *grey* (not red, not the
            accent) ambient "other threads are waiting" cue: a translucent
            medium-grey fill that reads against the header's grey background
            (plain `neutral`'s soft fill was nearly invisible there), with the
            number in the normal text color so it matches the chevron. The open
            conversation is excluded from the total while viewed, so the figure
            reads as *other* threads. The
            plain wrapper keeps the pill vertically centered (AppButton's
            content-hug sets `alignSelf: flex-start`, which would otherwise pin it
            to the top of this row). */}
        <View>
          <AppButton
            variant="ghost"
            fullWidth={false}
            corner="full"
            compact
            onPress={() => router.back()}
            accessibilityLabel="Back"
            iconLeft={
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 1 }}>
                <ChevronLeft
                  strokeWidth={iconStrokeWidth.default}
                  size={uiDensity.headerActionIconSize}
                  color={c.text}
                  style={directionalIconStyle}
                />
                {otherUnread > 0 ? <CountBadge count={otherUnread} tone="neutralStrong" /> : null}
              </View>
            }
          />
        </View>

        {/* Avatar — iOS-style trailing accessory; opens the matching identity details. */}
        <Pressable
          onPress={openDetails}
          disabled={!counterpartyPubkey}
          hitSlop={8}
          style={{
            // Keep the visible avatar on the content gutter at either density.
            width: HEADER_AVATAR_SIZE + spacing.sm,
            height: uiDensity.headerActionSize,
            paddingEnd: spacing.sm,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Avatar
            pubkey={counterpartyPubkey ?? '0'.repeat(64)}
            picture={pictureOverride ?? profile?.picture}
            name={name}
            size={HEADER_AVATAR_SIZE}
          />
        </Pressable>
      </View>
    </View>
  );
}
