import { setAccountEncryptionPubkey } from '@/services/account/account.service';
import { dmService } from '@/services/dm/dm.service';
import {
  generateEncryptionKeypair,
  type EncryptionKeypair,
  publishEncryptionKeyAnnouncement,
} from '@/services/dm/encryption-key.service';
import type { Signer } from '@/services/signer/signer.interface';
import {
  beginMessagingSendPreparation,
  completeMessagingSendPreparation,
  failMessagingSendPreparation,
} from '@/services/dm/messaging-send-readiness';

import { getKeyRotationIntervalDays } from './encryption-key-rotation-prefs';

const SECONDS_PER_DAY = 24 * 60 * 60;

type RotationContext = {
  accountPubkey: string;
  signer: Signer;
  dmRelays: string[];
  announcementRelays: string[];
};

const rotationsInFlight = new Map<string, Promise<EncryptionKeypair>>();

/** Replace the current encryption key, announce it, then restore the live DM
 * stream when this account owned one before the rotation. Older keys remain in
 * the bounded key list so messages sent through a stale peer cache can still be
 * read during the transition. */
async function performRotation({
  accountPubkey,
  signer,
  dmRelays,
  announcementRelays,
}: RotationContext): Promise<EncryptionKeypair> {
  const shouldRestoreLiveStream = dmService.getAccountPubkey() === accountPubkey;
  if (shouldRestoreLiveStream) beginMessagingSendPreparation(accountPubkey);
  dmService.destroy();

  let keypair: EncryptionKeypair | null = null;
  try {
    keypair = await generateEncryptionKeypair(accountPubkey);
    await setAccountEncryptionPubkey(accountPubkey, keypair.pubkey);
    await publishEncryptionKeyAnnouncement({
      signer,
      encryptionPubkey: keypair.pubkey,
      relays: announcementRelays,
    });
    return keypair;
  } finally {
    // A local key is persisted before publication so it is never announced
    // without being held. Even if publication fails, restore the stream with
    // that new current key; startup reconciliation will retry the announcement.
    if (shouldRestoreLiveStream) {
      try {
        await dmService.init({ accountPubkey, dmRelays });
        completeMessagingSendPreparation(accountPubkey);
      } catch (error) {
        failMessagingSendPreparation(accountPubkey, error);
        throw error;
      }
    }
  }
}

/** Coalesce overlapping startup/manual requests on one device so two callers
 * can never generate and announce two successive keys for the same account. */
export function rotateEncryptionKey(context: RotationContext): Promise<EncryptionKeypair> {
  const existing = rotationsInFlight.get(context.accountPubkey);
  if (existing) return existing;

  const rotation = performRotation(context);
  rotationsInFlight.set(context.accountPubkey, rotation);
  const clear = () => {
    if (rotationsInFlight.get(context.accountPubkey) === rotation) {
      rotationsInFlight.delete(context.accountPubkey);
    }
  };
  void rotation.then(clear, clear);
  return rotation;
}

/** Startup check. This runs after the account has reconciled its latest remote
 * announcement, outside the blocking boot path. Missing legacy timestamps are
 * normalized by `loadEncryptionKeys`, so upgrades start a fresh interval rather
 * than rotating unexpectedly on first launch. */
export async function rotateEncryptionKeyIfDue(
  context: RotationContext & { currentKey: EncryptionKeypair; now?: number },
): Promise<boolean> {
  const intervalDays = await getKeyRotationIntervalDays(context.accountPubkey);
  if (intervalDays === null) return false;
  const now = context.now ?? Math.floor(Date.now() / 1000);
  if (now - context.currentKey.createdAt < intervalDays * SECONDS_PER_DAY) return false;

  await rotateEncryptionKey(context);
  return true;
}
