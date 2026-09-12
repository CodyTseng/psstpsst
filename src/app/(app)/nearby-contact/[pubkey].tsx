import { useLocalSearchParams } from 'expo-router';

import { NearbyContactDetail } from '@/components/nearby/NearbyContactDetail';

export default function NearbyContactScreen() {
  const { pubkey, name } = useLocalSearchParams<{ pubkey: string; name?: string }>();

  if (!pubkey) return null;
  return <NearbyContactDetail pubkey={pubkey} fallbackName={name} />;
}
