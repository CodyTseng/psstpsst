import { useLocalSearchParams } from 'expo-router';

import { IncomingShareForwardScreen } from '@/components/share/IncomingShareForwardScreen';
import { ForwardTargetScreen } from '@/components/share/ForwardTargetScreen';

export default function ForwardRoute() {
  const { kind } = useLocalSearchParams<{ kind?: string }>();
  if (kind === 'external') return <IncomingShareForwardScreen />;
  return <ForwardTargetScreen />;
}
