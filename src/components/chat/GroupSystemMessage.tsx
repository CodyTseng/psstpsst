import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { AppButton } from '@/components/common/AppButton';
import { useContact } from '@/hooks/use-contacts';
import { useProfile } from '@/hooks/use-profile';
import { resolveDisplayName } from '@/lib/nostr/display-name';
import { parseGroupAction } from '@/lib/nostr/group-messaging';
import type { MessageDelivery } from '@/stores/delivery-status.store';
import { spacing, useThemeColors } from '@/theme';

import { MessageDeliveryStatus } from './MessageDeliveryStatus';

type Props = {
  accountPubkey: string;
  conversationKey: string;
  senderPubkey: string;
  tags: string[][];
  delivery: MessageDelivery | null;
  onShowDelivery?: () => void;
};

export function GroupSystemMessage({
  accountPubkey,
  conversationKey,
  senderPubkey,
  tags,
  delivery,
  onShowDelivery,
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
      }}
    >
      <AppButton
        label={label}
        accessibilityLabel={label}
        labelVariant="caption"
        labelNumberOfLines={1}
        variant="secondary"
        size="sm"
        fullWidth={false}
        iconRight={
          own && delivery ? <MessageDeliveryStatus delivery={delivery} color={c.textMuted} /> : null
        }
        onPress={
          own && onShowDelivery
            ? onShowDelivery
            : () => router.push(`/group/${encodeURIComponent(conversationKey)}`)
        }
      />
    </View>
  );
}
