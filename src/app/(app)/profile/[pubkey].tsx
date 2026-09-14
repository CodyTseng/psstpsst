import { useLocalSearchParams } from 'expo-router';

import { PeerProfile } from '@/components/profile/PeerProfile';
import { ProfileView } from '@/components/profile/ProfileView';
import { InvalidRouteRedirect } from '@/components/navigation/InvalidRouteRedirect';
import { routeHexIdParam } from '@/lib/navigation/route-params';
import { useActiveAccount } from '@/stores/active-account.store';

export default function ProfileScreen() {
  const params = useLocalSearchParams<{
    pubkey: string | string[];
    chat?: string | string[];
  }>();
  const pubkey = routeHexIdParam(params.pubkey);
  const activePubkey = useActiveAccount((s) => s.activePubkey);

  if (!pubkey || (params.chat !== undefined && params.chat !== '1')) {
    return <InvalidRouteRedirect />;
  }
  // Own profile opened from elsewhere (Settings, contacts) keeps the savable-QR
  // edit hub. Opened from a chat header (`?chat=1`) — including note-to-self —
  // we want the conversation-detail peer view (search / media / mute …), with
  // PeerProfile dropping the actions that can't apply to yourself.
  if (pubkey === activePubkey && params.chat !== '1') return <ProfileView pubkey={pubkey} />;
  return <PeerProfile pubkey={pubkey} />;
}
