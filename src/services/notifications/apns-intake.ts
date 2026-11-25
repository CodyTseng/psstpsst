import type { NotificationCommunication } from '@/platform/ports/notifications';
import { KIND_REACTION } from '@/services/crypto/nip17-gift-wrap';
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
  runtime: Pick<GiftWrapReceiveContext, 'userPresent' | 'activeConversation' | 'isCurrent' | 'getCurrentPresence'>,
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
    const userPresent = runtime.getCurrentPresence?.().userPresent ?? runtime.userPresent;
    const qualifying = await evaluateNotificationRumors(rumors, input.accountPubkey, userPresent, 'relay');
    if (!runtime.isCurrent() || qualifying.length === 0) continue;
    const latest = qualifying.reduce((current, candidate) =>
      isMessageOrderNewer(
        { orderAt: messageOrderAt(candidate.rumor), id: candidate.rumor.id },
        { orderAt: messageOrderAt(current.rumor), id: current.rumor.id },
      ) ? candidate : current);
    const content = await buildNotificationContent(latest.rumor, qualifying.length, input.accountPubkey, {
      conversation: latest.conversation,
      hasReactions: qualifying.some(candidate => candidate.rumor.kind === KIND_REACTION),
    });
    if (!runtime.isCurrent()) return null;
    return { accountPubkey: input.accountPubkey, rumorId: latest.rumor.id, ...content };
  }
  return null;
}
