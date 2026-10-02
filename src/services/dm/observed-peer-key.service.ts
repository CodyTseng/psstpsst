import { eq } from 'drizzle-orm';

import { db } from '@/db/client';
import { observedPeerEncryptionKeys } from '@/db/schema';
import { isMessageOrderNewer } from '@/lib/nostr/message-order';

type ObservedPeerKey = typeof observedPeerEncryptionKeys.$inferSelect;

type RememberPeerKeyEvidence = {
  peerPubkey: string;
  encryptionPubkey: string;
  source: ObservedPeerKey['source'];
  evidenceId: string;
  evidenceCreatedAt: number;
  announcementCheckedAt?: number;
};

/**
 * Device-wide key evidence from incoming seals and public announcements. Only
 * the newest signed event owns the peer row; delayed history cannot roll it back.
 */
class ObservedPeerKeyService {
  private cache = new Map<string, ObservedPeerKey | null>();
  private writes = new Map<string, Promise<void>>();
  private listeners = new Set<(peerPubkey: string) => void>();

  async resolve(peerPubkey: string): Promise<ObservedPeerKey | null> {
    if (this.cache.has(peerPubkey)) return this.cache.get(peerPubkey) ?? null;
    const row = await db
      .select()
      .from(observedPeerEncryptionKeys)
      .where(eq(observedPeerEncryptionKeys.peerPubkey, peerPubkey))
      .get();
    this.cache.set(peerPubkey, row ?? null);
    return row ?? null;
  }

  rememberVerifiedSealKey(observation: Omit<RememberPeerKeyEvidence, 'source'>): Promise<void> {
    return this.remember({ ...observation, source: 'seal' });
  }

  rememberKeyAnnouncement(
    observation: Omit<RememberPeerKeyEvidence, 'source'>,
  ): Promise<void> {
    return this.remember({ ...observation, source: 'kind-10044' });
  }

  private async remember(observation: RememberPeerKeyEvidence): Promise<void> {
    if (!/^[0-9a-f]{64}$/i.test(observation.encryptionPubkey)) return;
    const key = observation.peerPubkey;
    const previousWrite = this.writes.get(key) ?? Promise.resolve();
    const write = previousWrite
      .catch(() => {})
      .then(() => this.rememberSerial(key, observation));
    this.writes.set(key, write);
    try {
      await write;
    } finally {
      if (this.writes.get(key) === write) this.writes.delete(key);
    }
  }

  onKeyChanged(listener: (peerPubkey: string) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async markAnnouncementChecked(peerPubkey: string, checkedAt: number): Promise<void> {
    const existing = await this.resolve(peerPubkey);
    if (!existing || (existing.announcementCheckedAt ?? 0) >= checkedAt) return;
    await db
      .update(observedPeerEncryptionKeys)
      .set({ announcementCheckedAt: checkedAt })
      .where(eq(observedPeerEncryptionKeys.peerPubkey, peerPubkey));
    this.cache.set(peerPubkey, { ...existing, announcementCheckedAt: checkedAt });
  }

  private async rememberSerial(
    key: string,
    observation: RememberPeerKeyEvidence,
  ): Promise<void> {
    await this.resolve(observation.peerPubkey);
    const existing = this.cache.get(key);
    if (
      existing &&
      !isMessageOrderNewer(
        { orderAt: observation.evidenceCreatedAt, id: observation.evidenceId },
        { orderAt: existing.evidenceCreatedAt, id: existing.evidenceId },
      )
    ) return;

    const keyChanged = existing?.encryptionPubkey !== observation.encryptionPubkey;

    const row: ObservedPeerKey = {
      ...observation,
      announcementCheckedAt:
        observation.announcementCheckedAt ?? existing?.announcementCheckedAt ?? null,
      observedAt: Math.floor(Date.now() / 1000),
    };
    await db
      .insert(observedPeerEncryptionKeys)
      .values(row)
      .onConflictDoUpdate({
        target: observedPeerEncryptionKeys.peerPubkey,
        set: {
          encryptionPubkey: row.encryptionPubkey,
          source: row.source,
          evidenceId: row.evidenceId,
          evidenceCreatedAt: row.evidenceCreatedAt,
          announcementCheckedAt: row.announcementCheckedAt,
          observedAt: row.observedAt,
        },
      });
    this.cache.set(key, row);
    if (!keyChanged) return;
    for (const listener of this.listeners) {
      try {
        listener(observation.peerPubkey);
      } catch {
        // A UI subscriber must not interrupt message intake.
      }
    }
  }
}

export const observedPeerKeyService = new ObservedPeerKeyService();
