import { useStore } from 'zustand';
import { useShallow } from 'zustand/react/shallow';

import { deliveryStatusStore } from '@/services/dm/delivery-status';
import type { MessageDelivery } from '@/services/dm/delivery-status';

/**
 * React binding over the service-owned delivery state
 * (`services/dm/delivery-status.ts`). Only nearby transport needs session-only
 * progress; relay delivery is read from SQLite.
 */
export {
  deliveryCounts,
  beginRelayTargets,
  relayDeliveryVerdict,
  retryableRelayUrls,
  surfacedCopies,
  surfacedRelays,
  settleRelayTarget,
} from '@/services/dm/delivery-status';
export type {
  DeliveryCopy,
  DeliveryPhase,
  MessageDelivery,
  RelayDelivery,
  RelayDeliveryStatus,
} from '@/services/dm/delivery-status';

/** Subscribe a single bubble to its own delivery entry (null if untracked). */
export function useDelivery(rumorId: string): MessageDelivery | null {
  return useStore(deliveryStatusStore, useShallow((s) => s.byId[rumorId] ?? null));
}
