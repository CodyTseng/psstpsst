import type { ConversationDeliveryKind } from './capabilities';
import type { ConversationRouteParams } from '@/lib/navigation/route-params';

/** A conversation-addressed send target. Payload creation never depends on a
 * recipient identity; the delivery service resolves the target by transport. */
export type ConversationTarget = {
  deliveryKind: ConversationDeliveryKind;
  conversationKey: string;
  group?: boolean;
};

export function conversationTargetFromRoute(
  route: ConversationRouteParams,
): ConversationTarget | null {
  const group = route.key.startsWith('group:');
  if (group && route.transport === 'proximity') return null;
  return {
    deliveryKind: route.transport,
    conversationKey: route.key,
    ...(group ? { group: true } : {}),
  };
}
