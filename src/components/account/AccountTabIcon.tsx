import { View } from 'react-native';

import { Avatar } from '@/components/common/Avatar';
import { useProfile } from '@/hooks/use-profile';
import { useActiveAccount } from '@/stores/active-account.store';
import { useThemeColors } from '@/theme';

type Props = {
  focused: boolean;
  size: number;
};

const ACTIVE_RING_WIDTH = 2;

/** The active account's avatar, used as the Me tab icon. */
export function AccountTabIcon({ focused, size }: Props) {
  const c = useThemeColors();
  const activePubkey = useActiveAccount((state) => state.activePubkey);
  const profile = useProfile(activePubkey);

  return (
    <View style={{ width: size, height: size }}>
      <Avatar pubkey={activePubkey ?? ''} picture={profile?.picture} size={size} />
      {focused ? (
        <View
          style={{
            position: 'absolute',
            inset: 0,
            borderRadius: size / 2,
            borderWidth: ACTIVE_RING_WIDTH,
            borderColor: c.accent,
            pointerEvents: 'none',
          }}
        />
      ) : null}
    </View>
  );
}
