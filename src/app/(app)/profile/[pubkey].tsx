import { useLocalSearchParams } from 'expo-router';

import { PeerProfile } from '@/components/profile/PeerProfile';
import { ProfileView } from '@/components/profile/ProfileView';
import { useActiveAccount } from '@/stores/active-account.store';

export default function ProfileScreen() {
  const { pubkey, chat } = useLocalSearchParams<{ pubkey: string; chat?: string }>();
  const activePubkey = useActiveAccount((s) => s.activePubkey);

  if (!pubkey) return null;
  // Own profile opened from elsewhere (Settings, contacts) keeps the savable-QR
  // edit hub. Opened from a chat header (`?chat=1`) — including note-to-self —
  // we want the conversation-detail peer view (search / media / mute …), with
  // PeerProfile dropping the actions that can't apply to yourself.
  if (pubkey === activePubkey && !chat) return <ProfileView pubkey={pubkey} />;
  return <PeerProfile pubkey={pubkey} />;
}
