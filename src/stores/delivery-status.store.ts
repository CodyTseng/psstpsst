import { useStore } from 'zustand';
import { useShallow } from 'zustand/react/shallow';

import { deliveryStatusStore } from '@/services/dm/delivery-status';
import type { MessageDelivery } from '@/services/dm/delivery-status';

/**
 * React binding over the service-owned delivery state
 * (`services/dm/delivery-status.ts`) — the send pipeline drives the vanilla
 * store; components subscribe through here.
 */
export {
  deliveryCounts,
  failedRelayRetryUrls,
  surfacedCopies,
  surfacedRelays,
} from '@/services/dm/delivery-status';
export type {
  CopyInit,
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
