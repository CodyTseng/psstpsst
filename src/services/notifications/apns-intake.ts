import type { NotificationCommunication } from '@/platform/ports/notifications';
import type { Rumor } from '@/db/schema/types';
import { DmService, type GiftWrapReceiveContext } from '@/services/dm/dm.service';
import { loadEncryptionKeypair } from '@/services/dm/encryption-key.service';
import { messageOrderAt, isMessageOrderNewer } from '@/lib/nostr/message-order';

import { resolveApnsGiftWrap } from './apns-gift-wrap';
import { buildNotificationContent, evaluateNotificationRumors } from './notification-policy';

export type ApnsIntakeResult = {
  accountPubkey: string;
  rumorId: string;
  title: string;
  subtitle?: string;
  body?: string;
  avatarUrl?: string;
  communication?: NotificationCommunication;
};

/** APNs only adapts delivery inputs; validation and persistence are the DM receiver's. */
export async function processApnsGiftWrap(
  payload: unknown,
  runtime: Pick<GiftWrapReceiveContext, 'userPresent' | 'activeConversation' | 'isCurrent'>,
): Promise<ApnsIntakeResult | null> {
  const receiver = new DmService();
  for (const input of await resolveApnsGiftWrap(payload)) {
    if (!runtime.isCurrent()) return null;
    const encryptionKeypair = await loadEncryptionKeypair(input.accountPubkey);
    const rumors = await receiver.receiveGiftWrap(input.event, {
      ...runtime,
      accountPubkey: input.accountPubkey,
      encryptionKeypair,
      sourceRelays: [input.sourceRelay],
    });
    const qualifying = await evaluateNotificationRumors(rumors, input.accountPubkey, runtime.userPresent);
    if (!runtime.isCurrent() || qualifying.length === 0) continue;
    const latest = qualifying.reduce((current: Rumor, candidate) =>
      isMessageOrderNewer(
        { orderAt: messageOrderAt(candidate), id: candidate.id },
        { orderAt: messageOrderAt(current), id: current.id },
      ) ? candidate : current);
    const content = await buildNotificationContent(latest, qualifying.length, input.accountPubkey);
    if (!runtime.isCurrent()) return null;
    return { accountPubkey: input.accountPubkey, rumorId: latest.id, ...content };
  }
  return null;
}
