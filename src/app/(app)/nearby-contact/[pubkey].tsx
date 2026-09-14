import { useLocalSearchParams } from 'expo-router';

import { NearbyContactDetail } from '@/components/nearby/NearbyContactDetail';
import { InvalidRouteRedirect } from '@/components/navigation/InvalidRouteRedirect';
import { optionalRouteTextParam, routeHexIdParam } from '@/lib/navigation/route-params';

export default function NearbyContactScreen() {
  const params = useLocalSearchParams<{
    pubkey: string | string[];
    name?: string | string[];
  }>();
  const pubkey = routeHexIdParam(params.pubkey);
  const name = optionalRouteTextParam(params.name, 256);

  if (!pubkey || name === null) return <InvalidRouteRedirect />;
  return <NearbyContactDetail pubkey={pubkey} fallbackName={name} />;
}
