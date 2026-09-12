import { and, eq } from 'drizzle-orm';

import { db } from '@/db/client';
import { conversations, proximityPeers } from '@/db/schema';

import { normalizeProximityDisplayName } from './proximity-display-name';

/** Set or clear a device-local nickname without overwriting the peer's signed name. */
export async function setProximityPeerNickname(
  accountPubkey: string,
  proximityPubkey: string,
  value: string,
): Promise<void> {
  const nickname = normalizeProximityDisplayName(value) || null;
  const peerWhere = and(
    eq(proximityPeers.accountPubkey, accountPubkey),
    eq(proximityPeers.proximityPubkey, proximityPubkey),
  );

  await db.transaction(async (tx) => {
    const peer = await tx
      .select({ displayName: proximityPeers.displayName })
      .from(proximityPeers)
      .where(peerWhere)
      .limit(1)
      .get();
    if (!peer) throw new Error('Nearby peer not found');

    await tx.update(proximityPeers).set({ nickname }).where(peerWhere).run();
    await tx
      .update(conversations)
      .set({ name: nickname ?? peer.displayName })
      .where(
        and(
          eq(conversations.accountPubkey, accountPubkey),
          eq(conversations.conversationKey, proximityPubkey),
          eq(conversations.deliveryKind, 'proximity'),
        ),
      )
      .run();
  });
}

export type ImportedProximityPeer = {
  pubkey: string;
  displayName: string;
  nickname: string | null;
  lastSeenAt: number;
};

/** Restore device-local labels without restoring trust, block, or connection
 * failure state. A nickname already present on this device wins over an older
 * archive value. */
export async function importProximityPeers(
  accountPubkey: string,
  peers: ImportedProximityPeer[],
): Promise<void> {
  if (peers.length === 0) return;
  await db.transaction(async (tx) => {
    for (const peer of peers) {
      const peerWhere = and(
        eq(proximityPeers.accountPubkey, accountPubkey),
        eq(proximityPeers.proximityPubkey, peer.pubkey),
      );
      const existing = await tx
        .select({
          displayName: proximityPeers.displayName,
          nickname: proximityPeers.nickname,
          lastSeenAt: proximityPeers.lastSeenAt,
        })
        .from(proximityPeers)
        .where(peerWhere)
        .limit(1)
        .get();
      const archiveIsNewer = !existing || peer.lastSeenAt > existing.lastSeenAt;
      const displayName = archiveIsNewer ? peer.displayName : existing.displayName;
      const nickname = existing?.nickname ?? peer.nickname;
      const lastSeenAt = Math.max(existing?.lastSeenAt ?? 0, peer.lastSeenAt);

      await tx
        .insert(proximityPeers)
        .values({
          accountPubkey,
          proximityPubkey: peer.pubkey,
          displayName,
          nickname,
          lastSeenAt,
          connectedAt: null,
          blockedAt: null,
          connectionFailure: null,
        })
        .onConflictDoUpdate({
          target: [proximityPeers.accountPubkey, proximityPeers.proximityPubkey],
          set: { displayName, nickname, lastSeenAt },
        })
        .run();
      await tx
        .update(conversations)
        .set({ name: nickname ?? displayName })
        .where(
          and(
            eq(conversations.accountPubkey, accountPubkey),
            eq(conversations.conversationKey, peer.pubkey),
            eq(conversations.deliveryKind, 'proximity'),
          ),
        )
        .run();
    }
  });
}
