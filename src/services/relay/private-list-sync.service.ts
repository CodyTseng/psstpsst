import { and, eq, sql } from 'drizzle-orm';

import { db, type Database } from '@/db/client';
import { privateListSyncState } from '@/db/schema';

import { buildSigner } from '../account/account.service';
import type { Signer } from '../signer/signer.interface';
import { enqueueConfigurationEvent } from './configuration-publish.service';
import { getReplaceableEvent } from './replaceable-events.service';

async function readState(accountPubkey: string, dTag: string, tx: Database) {
  return (await tx.select().from(privateListSyncState).where(and(
    eq(privateListSyncState.accountPubkey, accountPubkey),
    eq(privateListSyncState.dTag, dTag),
  )).limit(1))[0];
}

/** Commit this revision in the same transaction as the plaintext edit. */
export async function markPrivateListDirty(accountPubkey: string, dTag: string, tx: Database): Promise<void> {
  await tx.insert(privateListSyncState).values({ accountPubkey, dTag, revision: 1, dirty: true })
    .onConflictDoUpdate({
      target: [privateListSyncState.accountPubkey, privateListSyncState.dTag],
      set: { revision: sql`${privateListSyncState.revision} + 1`, dirty: true },
    });
}

type Publication = {
  accountPubkey: string;
  dTag: string;
  title: string;
  readTags: (tx: Database) => Promise<string[][]>;
  signer?: Signer;
  eventTags?: string[][];
  sourceEventId?: string;
};
type Job = { requested: boolean; publication: Publication };
const jobs = new Map<string, Job>();

/** Local writes never await crypto. Each queued attempt reads fresh plaintext;
 * failure leaves its revision dirty and does not request another attempt. */
export function queuePrivateListPublication(publication: Publication): void {
  const key = JSON.stringify([publication.accountPubkey, publication.dTag]);
  const existing = jobs.get(key);
  if (existing) {
    existing.requested = true;
    existing.publication = publication;
    return;
  }
  const job: Job = { requested: true, publication };
  jobs.set(key, job);
  setTimeout(() => {
    void (async () => {
      try {
        while (job.requested) {
          job.requested = false;
          try { await publish(job.publication); } catch {
            // Dirty plaintext remains authoritative until the next local edit.
          }
          if (job.requested) await new Promise((resolve) => setTimeout(resolve, 0));
        }
      } finally { jobs.delete(key); }
    })();
  }, 0);
}

async function publish(publication: Publication): Promise<void> {
  const { accountPubkey, dTag } = publication;
  const signer = publication.signer ?? (await buildSigner(accountPubkey));
  if (!signer.nip44Encrypt) return;
  const snapshot = await db.transaction(async (tx) => {
    const state = await readState(accountPubkey, dTag, tx);
    if (!state?.dirty) return null;
    return { state, tags: await publication.readTags(tx) };
  });
  if (!snapshot) return;
  const previous = await getReplaceableEvent({ pubkey: accountPubkey, kind: 30000, dTag });
  if (previous && publication.sourceEventId && previous.id !== publication.sourceEventId) return;
  const content = await signer.nip44Encrypt(accountPubkey, JSON.stringify(snapshot.tags));
  const event = await signer.signEvent({
    kind: 30000,
    tags: publication.eventTags ?? [['d', dTag], ['title', publication.title]],
    content,
    created_at: Math.max(Math.floor(Date.now() / 1000), (previous?.created_at ?? 0) + 1),
  });
  if (event.pubkey !== accountPubkey) throw new Error('Private-list signer does not match the account.');
  await enqueueConfigurationEvent(event, async (_event, tx) => {
    if ((await readState(accountPubkey, dTag, tx))?.revision !== snapshot.state.revision) {
      throw new Error('Private-list revision changed while signing.');
    }
    await tx.update(privateListSyncState).set({ dirty: false, eventId: event.id }).where(and(
      eq(privateListSyncState.accountPubkey, accountPubkey),
      eq(privateListSyncState.dTag, dTag),
    ));
  }, previous?.id ?? null);
}
