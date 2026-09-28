import UserMinus from 'lucide-react-native/icons/user-minus';
import { router } from 'expo-router';
import { View } from 'react-native';

import { IconButton } from '@/components/common/IconButton';
import { ContactListItem } from '@/components/conversation/ContactListItem';
import { useContact } from '@/hooks/use-contacts';
import { useProfile } from '@/hooks/use-profile';
import { resolveDisplayName } from '@/lib/nostr/display-name';
import { iconStrokeWidth } from '@/theme/icons';
import { spacing, uiDensity, useThemeColors } from '@/theme';

type Props = {
  accountPubkey: string;
  pubkey: string;
  removable: boolean;
  removeLabel: string;
  onRemove: () => void;
};

export function GroupMemberRow({ accountPubkey, pubkey, removable, removeLabel, onRemove }: Props) {
  const c = useThemeColors();
  const profile = useProfile(pubkey);
  const contact = useContact(accountPubkey, pubkey);
  const displayName = resolveDisplayName(pubkey, {
    petname: contact?.petname,
    displayName: profile?.displayName,
    name: profile?.name,
  });
  return (
    <View>
      <ContactListItem
        counterpartyPubkey={pubkey}
        displayName={displayName}
        picture={profile?.picture}
        showSelfBadge={false}
        trailingInset={removable ? uiDensity.iconButtonSize + spacing.sm : 0}
        onPress={() => router.push(`/profile/${encodeURIComponent(pubkey)}`)}
      />
      {removable ? (
        <IconButton
          variant="plain"
          accessibilityLabel={removeLabel}
          onPress={onRemove}
          icon={<UserMinus size={18} color={c.danger} strokeWidth={iconStrokeWidth.default} />}
          style={{ position: 'absolute', end: spacing.lg, top: spacing.sm }}
        />
      ) : null}
    </View>
  );
}
