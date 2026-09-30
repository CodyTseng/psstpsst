import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { AppText } from '@/components/common/AppText';
import {
  InteractivePressable as Pressable,
  isInteractiveHovered,
} from '@/components/common/InteractivePressable';
import { useContact } from '@/hooks/use-contacts';
import { useProfile } from '@/hooks/use-profile';
import { resolveDisplayName } from '@/lib/nostr/display-name';
import { parseGroupAction } from '@/lib/nostr/group-messaging';
import type { MessageDelivery } from '@/stores/delivery-status.store';
import { spacing, useThemeColors } from '@/theme';

import {
  MESSAGE_DELIVERY_ICON_SIZE,
  MessageDeliveryStatus,
} from './MessageDeliveryStatus';

type Props = {
  accountPubkey: string;
  senderPubkey: string;
  tags: string[][];
  delivery: MessageDelivery | null;
  onShowDetail?: () => void;
};

export function GroupSystemMessage({
  accountPubkey,
  senderPubkey,
  tags,
  delivery,
  onShowDetail,
}: Props) {
  const { t } = useTranslation();
  const c = useThemeColors();
  const parsed = parseGroupAction(tags);
  const targetPubkey =
    parsed.status === 'valid' &&
    (parsed.action.type === 'invite' || parsed.action.type === 'remove')
      ? parsed.action.memberPubkey
      : '';
  const senderProfile = useProfile(senderPubkey);
  const senderContact = useContact(accountPubkey, senderPubkey);
  const targetProfile = useProfile(targetPubkey || null);
  const targetContact = useContact(accountPubkey, targetPubkey);
  if (
    parsed.status !== 'valid' ||
    (parsed.action.type !== 'invite' &&
      parsed.action.type !== 'remove' &&
      parsed.action.type !== 'rename')
  ) {
    return null;
  }
  const actor = resolveDisplayName(senderPubkey, {
    petname: senderContact?.petname,
    displayName: senderProfile?.displayName,
    name: senderProfile?.name,
  });
  const member = targetPubkey
    ? resolveDisplayName(targetPubkey, {
        petname: targetContact?.petname,
        displayName: targetProfile?.displayName,
        name: targetProfile?.name,
      })
    : '';
  const label = parsed.action.type === 'invite'
    ? t('group.invited', { actor, member })
    : parsed.action.type === 'remove'
      ? parsed.action.memberPubkey === senderPubkey
        ? t('group.left', { actor })
        : t('group.removed', { actor, member })
      : parsed.action.name
        ? t('group.renamed', { actor, name: parsed.action.name })
        : t('group.cleared_name', { actor });
  const own = senderPubkey === accountPubkey;
  return (
    <View
      style={{
        alignItems: 'center',
        flexDirection: 'row',
        justifyContent: 'center',
        marginVertical: spacing.sm,
        paddingHorizontal: spacing.lg,
      }}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={label}
        onPress={onShowDetail}
        hitSlop={spacing.sm}
        fallbackHoverOpacity={false}
        style={{ maxWidth: '100%' }}
      >
        {(state) => {
          const color = isInteractiveHovered(state) || state.pressed ? c.text : c.textMuted;
          return (
            <View
              style={{
                alignItems: 'center',
                flexDirection: 'row',
                gap: spacing.xs,
                maxWidth: '100%',
              }}
            >
              <AppText
                variant="caption"
                numberOfLines={1}
                ellipsizeMode="tail"
                style={{ color, flexShrink: 1, userSelect: 'none' }}
              >
                {label}
              </AppText>
              {own && delivery ? (
                <MessageDeliveryStatus
                  delivery={delivery}
                  color={color}
                  size={MESSAGE_DELIVERY_ICON_SIZE}
                />
              ) : null}
            </View>
          );
        }}
      </Pressable>
    </View>
  );
}
