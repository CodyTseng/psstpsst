import { and, asc, eq } from 'drizzle-orm';
import type { Event, EventTemplate } from 'nostr-tools';

import { db } from '@/db/client';
import {
  messageDeliveryCopies,
  messages,
  relayOutboxJobs,
  relayOutboxJobTargets,
  relayOutboxPayloads,
} from '@/db/schema';
import type { DeliveryRelayRecord } from '@/db/schema/message-delivery-copies';
import type { Rumor } from '@/db/schema/types';
import { normalizeRelayUrl } from '@/lib/nostr/relay-url';
import { getPTags } from '@/lib/nostr/tags';
import { platform } from '@/platform';

import { buildSigner } from '../account/account.service';
import {
  createGiftWrappedMessage,
  KIND_CHAT,
  KIND_FILE,
  type SignSeal,
} from '../crypto/nip17-gift-wrap';
import { fetchDmRelays } from '../relay/relay-list.service';
import { relayPool, type PublishOutcome } from '../relay/relay-pool';
import { capDeliveryRelays } from '../relay/relay-router';
import type { Signer } from '../signer/signer.interface';
import {
  beginRelayTargets,
  relayDeliveryVerdict,
  settleRelayTarget,
} from './delivery-status';
import { encryptionKeyWatcher } from './encryption-key-watcher';
import type { EncryptionKeypair } from './encryption-key.service';

const PUBLISH_TIMEOUT_MS = 10_000;

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

type RelayOutboxSession = {
  accountPubkey: string;
  encryptionKeypair: EncryptionKeypair;
  dmRelays: string[];
  signSeal: SignSeal;
};

type RelayJob = typeof relayOutboxJobs.$inferSelect;
type RelayTarget = typeof relayOutboxJobTargets.$inferSelect;

function isDurableDelivery(kind: number): boolean {
  return kind === KIND_CHAT || kind === KIND_FILE;
}

function normalizeTargets(urls: string[]): string[] {
  const normalized: string[] = [];
  const seen = new Set<string>();
  for (const url of urls) {
    try {
      const value = normalizeRelayUrl(url);
      if (!seen.has(value)) {
        seen.add(value);
        normalized.push(value);
      }
    } catch {
      // Invalid relay metadata cannot become a queue target.
    }
  }
  return normalized;
}

function pendingRelays(
  previous: DeliveryRelayRecord[] | undefined,
  targetUrls: string[],
): DeliveryRelayRecord[] {
  return beginRelayTargets(previous ?? [], targetUrls);
}

function messageError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isOffline(state: {
  isConnected?: boolean;
  isInternetReachable?: boolean;
}): boolean {
  return state.isConnected === false || state.isInternetReachable === false;
}

/**
 * Durable, account-scoped FIFO relay delivery. The database is both the queue
 * and the crash-recovery boundary; this class only owns the active worker.
 */
class RelayMessageOutbox {
  private session: RelayOutboxSession | null = null;
  private generation = 0;
  private drainTask: Promise<void> | null = null;
  private wakeRequested = false;
  private online = true;
  private observing = false;
  private currentPublishAbort: AbortController | null = null;
  private readonly messageWrites = new Map<string, Promise<void>>();

  private startObserving(): void {
    if (this.observing) return;
    this.observing = true;
    const networkState = platform.networkState;
    if (!networkState) return;
    networkState.addStateListener((state) => {
      this.online = !isOffline(state);
      if (!this.online) this.currentPublishAbort?.abort();
      else this.wake();
    });
    void networkState
      .getState()
      .then((state) => {
        this.online = !isOffline(state);
        if (this.online) this.wake();
      })
      .catch(() => {});
  }

  activate(session: RelayOutboxSession): void {
    this.startObserving();
    this.deactivate();
    this.session = session;
    this.generation += 1;
    this.wake();
  }

  deactivate(): void {
    this.generation += 1;
    this.currentPublishAbort?.abort();
    this.currentPublishAbort = null;
    this.session = null;
  }

  /** Account removal waits for already-started preparation and DB writes after
   * invalidating the session, so stale work cannot recreate deleted rows. */
  async waitForIdle(): Promise<void> {
    while (this.drainTask || this.messageWrites.size > 0) {
      await Promise.allSettled([
        ...(this.drainTask ? [this.drainTask] : []),
        ...this.messageWrites.values(),
      ]);
    }
  }

  wake(accountPubkey?: string): void {
    if (accountPubkey && this.session?.accountPubkey !== accountPubkey) return;
    // Some focused service tests replace the database module with an empty
    // boundary mock. Production adapters always expose the async query API.
    if (typeof (db as unknown as { select?: unknown }).select !== 'function') return;
    this.wakeRequested = true;
    if (this.drainTask) return;
    this.drainTask = this.drain()
      .catch((error) => {
        console.warn('[relay-outbox] Worker stopped after an unexpected error.', error);
      })
      .finally(() => {
        this.drainTask = null;
        if (this.wakeRequested) this.wake();
      });
  }

  async enqueueRetryAll(accountPubkey: string, messageId: string): Promise<void> {
    await db.transaction(async (tx) => {
      const message = await tx
        .select({ deliveryStatus: messages.deliveryStatus })
        .from(messages)
        .where(and(eq(messages.accountPubkey, accountPubkey), eq(messages.id, messageId)))
        .get();
      if (!message) throw new Error('Message not found');
      await tx.insert(relayOutboxJobs).values({
        accountPubkey,
        messageId,
        scope: 'all_recipient_relays',
        createdAt: nowSeconds(),
      });
      if (message.deliveryStatus !== 'sent') {
        await tx
          .update(messages)
          .set({ deliveryStatus: 'queued', deliveryError: null })
          .where(and(eq(messages.accountPubkey, accountPubkey), eq(messages.id, messageId)));
      }
    });
    this.wake(accountPubkey);
  }

  async enqueueRetryTargets(
    accountPubkey: string,
    messageId: string,
    relayUrls: string[],
  ): Promise<void> {
    const requested = new Set(normalizeTargets(relayUrls));
    if (requested.size === 0) return;
    await db.transaction(async (tx) => {
      const copies = await tx
        .select()
        .from(messageDeliveryCopies)
        .where(
          and(
            eq(messageDeliveryCopies.accountPubkey, accountPubkey),
            eq(messageDeliveryCopies.messageId, messageId),
          ),
        )
        .all();
      const nonSelf = copies.filter((copy) => copy.recipientPubkey !== accountPubkey);
      const surfaced = nonSelf.length > 0 ? nonSelf : [];
      const targets = surfaced.flatMap((copy) =>
        copy.relays
          .filter((relay) => relay.status === 'failed' && requested.has(relay.url))
          .map((relay) => ({ recipientPubkey: copy.recipientPubkey, relayUrl: relay.url })),
      );
      if (targets.length === 0) return;

      const [job] = await tx
        .insert(relayOutboxJobs)
        .values({
          accountPubkey,
          messageId,
          scope: 'selected_targets',
          createdAt: nowSeconds(),
        })
        .returning({ id: relayOutboxJobs.id })
        .all();
      if (!job) throw new Error('Failed to create relay retry job');
      await tx
        .insert(relayOutboxJobTargets)
        .values(targets.map((target) => ({ jobId: job.id, ...target })))
        .onConflictDoNothing();

      const message = await tx
        .select({ deliveryStatus: messages.deliveryStatus })
        .from(messages)
        .where(and(eq(messages.accountPubkey, accountPubkey), eq(messages.id, messageId)))
        .get();
      if (message?.deliveryStatus !== 'sent') {
        await tx
          .update(messages)
          .set({ deliveryStatus: 'queued', deliveryError: null })
          .where(and(eq(messages.accountPubkey, accountPubkey), eq(messages.id, messageId)));
      }
    });
    this.wake(accountPubkey);
  }

  private async drain(): Promise<void> {
    this.wakeRequested = false;
    const session = this.session;
    const generation = this.generation;
    if (!session || !this.online || platform.appState.currentState() !== 'active') return;

    while (
      this.session === session &&
      this.generation === generation &&
      this.online &&
      platform.appState.currentState() === 'active'
    ) {
      const job = await db
        .select()
        .from(relayOutboxJobs)
        .where(eq(relayOutboxJobs.accountPubkey, session.accountPubkey))
        .orderBy(asc(relayOutboxJobs.id))
        .limit(1)
        .get();
      if (!job) return;
      try {
        const completed = await this.processJob(job, session, generation);
        if (!completed) return;
      } catch (error) {
        console.warn('[relay-outbox] Worker paused after an unexpected error.', error);
        return;
      }
    }
  }

  private isCurrent(session: RelayOutboxSession, generation: number): boolean {
    return this.session === session && this.generation === generation;
  }

  private async processJob(
    job: RelayJob,
    session: RelayOutboxSession,
    generation: number,
  ): Promise<boolean> {
    const message = await db
      .select({ rumor: messages.rumor, kind: messages.kind })
      .from(messages)
      .where(
        and(
          eq(messages.accountPubkey, job.accountPubkey),
          eq(messages.id, job.messageId),
        ),
      )
      .get();
    if (!message) {
      await db.delete(relayOutboxJobs).where(eq(relayOutboxJobs.id, job.id));
      return true;
    }

    const rumor = message.rumor as Rumor;
    const durable = isDurableDelivery(message.kind);
    let targets = await this.loadTargets(job.id);
    if (targets.length === 0 && job.scope === 'all_recipient_relays') {
      try {
        targets = await this.prepareAllTargets(job, rumor, durable, session);
      } catch (error) {
        if (!this.isCurrent(session, generation) || !this.online) return false;
        await this.failBeforePublish(job, durable, messageError(error));
        return true;
      }
    }
    if (targets.length === 0) {
      await this.finishEmptyJob(job, durable);
      return true;
    }

    if (!this.isCurrent(session, generation) || !this.online) return false;
    targets = await this.skipSuccessfulTargets(job, targets, durable);
    if (targets.length === 0) return true;

    try {
      await this.ensurePayloads(job, rumor, targets, session);
    } catch (error) {
      if (!this.isCurrent(session, generation) || !this.online) return false;
      await this.failBeforePublish(job, durable, messageError(error), true);
      return true;
    }
    if (!this.isCurrent(session, generation) || !this.online) return false;
    if (durable) await this.markTargetsPending(job, targets);

    const payloadRows = await db
      .select()
      .from(relayOutboxPayloads)
      .where(eq(relayOutboxPayloads.jobId, job.id))
      .all();
    const payloadByRecipient = new Map(
      payloadRows.map((row) => [row.recipientPubkey, row.giftWrap] as const),
    );
    const byRecipient = new Map<string, RelayTarget[]>();
    for (const target of targets) {
      const entries = byRecipient.get(target.recipientPubkey) ?? [];
      entries.push(target);
      byRecipient.set(target.recipientPubkey, entries);
    }

    const abort = new AbortController();
    this.currentPublishAbort = abort;
    let signerPromise: Promise<Signer> | null = null;
    const signAuth = (template: EventTemplate): Promise<Event> => {
      signerPromise ??= buildSigner(job.accountPubkey);
      return signerPromise.then((signer) => signer.signEvent(template));
    };
    try {
      const writes: Promise<void>[] = [];
      await Promise.all(
        Array.from(byRecipient.entries()).map(async ([recipientPubkey, recipientTargets]) => {
          const giftWrap = payloadByRecipient.get(recipientPubkey);
          if (!giftWrap) throw new Error('Relay outbox payload is missing');
          const storedUrls = new Map<string, string[]>();
          for (const target of recipientTargets) {
            try {
              const normalized = normalizeRelayUrl(target.relayUrl);
              const urls = storedUrls.get(normalized) ?? [];
              urls.push(target.relayUrl);
              storedUrls.set(normalized, urls);
            } catch (error) {
              writes.push(
                this.settleTarget(
                  job,
                  recipientPubkey,
                  target.relayUrl,
                  { ok: false, reason: messageError(error) },
                  durable,
                ),
              );
            }
          }
          if (storedUrls.size === 0) return;
          await relayPool.publishEvent({
            relays: Array.from(storedUrls.keys()),
            event: giftWrap,
            signAuth,
            timeoutMs: PUBLISH_TIMEOUT_MS,
            abort: abort.signal,
            onRelay: (url, outcome) => {
              if (!abort.signal.aborted && this.isCurrent(session, generation)) {
                for (const storedUrl of storedUrls.get(url) ?? [url]) {
                  writes.push(
                    this.settleTarget(
                      job,
                      recipientPubkey,
                      storedUrl,
                      outcome,
                      durable,
                    ),
                  );
                }
              }
            },
          });
        }),
      );
      await Promise.all(writes);
      return !abort.signal.aborted;
    } finally {
      if (this.currentPublishAbort === abort) this.currentPublishAbort = null;
    }
  }

  private loadTargets(jobId: number): Promise<RelayTarget[]> {
    return db
      .select()
      .from(relayOutboxJobTargets)
      .where(eq(relayOutboxJobTargets.jobId, jobId))
      .all();
  }

  private async prepareAllTargets(
    job: RelayJob,
    rumor: Rumor,
    durable: boolean,
    session: RelayOutboxSession,
  ): Promise<RelayTarget[]> {
    const participants = Array.from(new Set([...getPTags(rumor.tags), job.accountPubkey]));
    if (participants.length === 0) throw new Error('Message has no recipients');

    const recipientRelays = new Map<string, string[]>();
    for (const participant of participants) {
      if (participant === job.accountPubkey) {
        const relays = normalizeTargets(capDeliveryRelays(session.dmRelays));
        if (relays.length === 0) throw new Error('Account has no DM relays');
        recipientRelays.set(participant, relays);
        continue;
      }
      const encryptionKey = await encryptionKeyWatcher.resolve(participant);
      if (!encryptionKey) {
        throw new Error(
          `Recipient ${participant.slice(0, 8)}… has no published NIP-17 encryption key`,
        );
      }
      const relays = normalizeTargets(capDeliveryRelays(await fetchDmRelays({
        pubkey: participant,
        searchRelays: session.dmRelays,
      })));
      if (relays.length === 0) {
        throw new Error(`Recipient ${participant.slice(0, 8)}… has no published DM relays`);
      }
      recipientRelays.set(participant, relays);
    }

    const now = nowSeconds();
    await db.transaction(async (tx) => {
      for (const [recipientPubkey, relays] of recipientRelays) {
        await tx
          .insert(relayOutboxJobTargets)
          .values(relays.map((relayUrl) => ({ jobId: job.id, recipientPubkey, relayUrl })))
          .onConflictDoNothing();
        if (!durable) continue;
        const existing = await tx
          .select({ relays: messageDeliveryCopies.relays })
          .from(messageDeliveryCopies)
          .where(
            and(
              eq(messageDeliveryCopies.accountPubkey, job.accountPubkey),
              eq(messageDeliveryCopies.messageId, job.messageId),
              eq(messageDeliveryCopies.recipientPubkey, recipientPubkey),
            ),
          )
          .get();
        const nextRelays = pendingRelays(existing?.relays, relays);
        await tx
          .insert(messageDeliveryCopies)
          .values({
            accountPubkey: job.accountPubkey,
            messageId: job.messageId,
            recipientPubkey,
            relays: nextRelays,
            updatedAt: now,
          })
          .onConflictDoUpdate({
            target: [
              messageDeliveryCopies.accountPubkey,
              messageDeliveryCopies.messageId,
              messageDeliveryCopies.recipientPubkey,
            ],
            set: { relays: nextRelays, updatedAt: now },
          });
      }
      if (durable) {
        await tx
          .update(messages)
          .set({ deliveryError: null })
          .where(
            and(
              eq(messages.accountPubkey, job.accountPubkey),
              eq(messages.id, job.messageId),
            ),
          );
      }
    });
    return this.loadTargets(job.id);
  }

  private async skipSuccessfulTargets(
    job: RelayJob,
    targets: RelayTarget[],
    durable: boolean,
  ): Promise<RelayTarget[]> {
    if (!durable) return targets;
    const copies = await db
      .select()
      .from(messageDeliveryCopies)
      .where(
        and(
          eq(messageDeliveryCopies.accountPubkey, job.accountPubkey),
          eq(messageDeliveryCopies.messageId, job.messageId),
        ),
      )
      .all();
    const successful = new Set(
      copies.flatMap((copy) =>
        copy.relays
          .filter((relay) => relay.status === 'ok')
          .map((relay) => `${copy.recipientPubkey}\n${relay.url}`),
      ),
    );
    const skipped = targets.filter((target) =>
      successful.has(`${target.recipientPubkey}\n${target.relayUrl}`),
    );
    for (const target of skipped) {
      await this.removeTarget(job, target.recipientPubkey, target.relayUrl, durable);
    }
    const remaining = targets.filter(
      (target) => !successful.has(`${target.recipientPubkey}\n${target.relayUrl}`),
    );
    return remaining;
  }

  private async markTargetsPending(job: RelayJob, targets: RelayTarget[]): Promise<void> {
    await this.serializeMessageWrite(job, async () => {
      await db.transaction(async (tx) => {
        const byRecipient = new Map<string, string[]>();
        for (const target of targets) {
          const urls = byRecipient.get(target.recipientPubkey) ?? [];
          urls.push(target.relayUrl);
          byRecipient.set(target.recipientPubkey, urls);
        }
        for (const [recipientPubkey, urls] of byRecipient) {
          const copy = await tx
            .select({ relays: messageDeliveryCopies.relays })
            .from(messageDeliveryCopies)
            .where(
              and(
                eq(messageDeliveryCopies.accountPubkey, job.accountPubkey),
                eq(messageDeliveryCopies.messageId, job.messageId),
                eq(messageDeliveryCopies.recipientPubkey, recipientPubkey),
              ),
            )
            .get();
          if (!copy) continue;
          await tx
            .update(messageDeliveryCopies)
            .set({ relays: pendingRelays(copy.relays, urls), updatedAt: nowSeconds() })
            .where(
              and(
                eq(messageDeliveryCopies.accountPubkey, job.accountPubkey),
                eq(messageDeliveryCopies.messageId, job.messageId),
                eq(messageDeliveryCopies.recipientPubkey, recipientPubkey),
              ),
            );
        }
      });
    });
  }

  private async ensurePayloads(
    job: RelayJob,
    rumor: Rumor,
    targets: RelayTarget[],
    session: RelayOutboxSession,
  ): Promise<void> {
    const existing = await db
      .select({ recipientPubkey: relayOutboxPayloads.recipientPubkey })
      .from(relayOutboxPayloads)
      .where(eq(relayOutboxPayloads.jobId, job.id))
      .all();
    const ready = new Set(existing.map((row) => row.recipientPubkey));
    const recipients = Array.from(new Set(targets.map((target) => target.recipientPubkey)));
    const rumorTemplate: EventTemplate = {
      kind: rumor.kind,
      content: rumor.content,
      tags: rumor.tags,
      created_at: rumor.created_at,
    };

    for (const recipientPubkey of recipients) {
      if (ready.has(recipientPubkey)) continue;
      const recipientEncPubkey =
        recipientPubkey === job.accountPubkey
          ? session.encryptionKeypair.pubkey
          : await encryptionKeyWatcher.resolve(recipientPubkey);
      if (!recipientEncPubkey) {
        throw new Error(
          `Recipient ${recipientPubkey.slice(0, 8)}… has no published NIP-17 encryption key`,
        );
      }
      // Gift-wrap crypto contains synchronous work; let the queued bubble paint
      // before each recipient is signed.
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
      const { giftWrap } = await createGiftWrappedMessage({
        rumorTemplate,
        senderIdentityPubkey: job.accountPubkey,
        senderEncPrivkey: session.encryptionKeypair.privkey,
        senderEncPubkey: session.encryptionKeypair.pubkey,
        recipientIdentityPubkey: recipientPubkey,
        recipientEncPubkey,
        signSeal: session.signSeal,
      });
      await db
        .insert(relayOutboxPayloads)
        .values({ jobId: job.id, recipientPubkey, giftWrap })
        .onConflictDoNothing();
    }
  }

  private settleTarget(
    job: RelayJob,
    recipientPubkey: string,
    relayUrl: string,
    outcome: PublishOutcome,
    durable: boolean,
  ): Promise<void> {
    return this.serializeMessageWrite(job, async () => {
      await db.transaction(async (tx) => {
        const target = await tx
          .select({ jobId: relayOutboxJobTargets.jobId })
          .from(relayOutboxJobTargets)
          .where(
            and(
              eq(relayOutboxJobTargets.jobId, job.id),
              eq(relayOutboxJobTargets.recipientPubkey, recipientPubkey),
              eq(relayOutboxJobTargets.relayUrl, relayUrl),
            ),
          )
          .get();
        if (!target) return;

        if (durable) {
          const copy = await tx
            .select()
            .from(messageDeliveryCopies)
            .where(
              and(
                eq(messageDeliveryCopies.accountPubkey, job.accountPubkey),
                eq(messageDeliveryCopies.messageId, job.messageId),
                eq(messageDeliveryCopies.recipientPubkey, recipientPubkey),
              ),
            )
            .get();
          if (copy) {
            const relays = settleRelayTarget(
              copy.relays,
              relayUrl,
              outcome.ok,
              outcome.ok ? undefined : outcome.reason,
            );
            await tx
              .update(messageDeliveryCopies)
              .set({ relays, updatedAt: nowSeconds() })
              .where(
                and(
                  eq(messageDeliveryCopies.accountPubkey, job.accountPubkey),
                  eq(messageDeliveryCopies.messageId, job.messageId),
                  eq(messageDeliveryCopies.recipientPubkey, recipientPubkey),
                ),
              );
          }
        }
        await this.removeTargetInTransaction(
          tx,
          job,
          recipientPubkey,
          relayUrl,
          durable,
        );
      });
    });
  }

  private removeTarget(
    job: RelayJob,
    recipientPubkey: string,
    relayUrl: string,
    durable: boolean,
  ): Promise<void> {
    return this.serializeMessageWrite(job, () =>
      db.transaction(async (tx) => {
        await this.removeTargetInTransaction(tx, job, recipientPubkey, relayUrl, durable);
      }),
    );
  }

  private async removeTargetInTransaction(
    tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
    job: RelayJob,
    recipientPubkey: string,
    relayUrl: string,
    durable: boolean,
  ): Promise<void> {
    await tx
      .delete(relayOutboxJobTargets)
      .where(
        and(
          eq(relayOutboxJobTargets.jobId, job.id),
          eq(relayOutboxJobTargets.recipientPubkey, recipientPubkey),
          eq(relayOutboxJobTargets.relayUrl, relayUrl),
        ),
      );
    const recipientTarget = await tx
      .select({ jobId: relayOutboxJobTargets.jobId })
      .from(relayOutboxJobTargets)
      .where(
        and(
          eq(relayOutboxJobTargets.jobId, job.id),
          eq(relayOutboxJobTargets.recipientPubkey, recipientPubkey),
        ),
      )
      .limit(1)
      .get();
    if (!recipientTarget) {
      await tx
        .delete(relayOutboxPayloads)
        .where(
          and(
            eq(relayOutboxPayloads.jobId, job.id),
            eq(relayOutboxPayloads.recipientPubkey, recipientPubkey),
          ),
        );
    }
    const remaining = await tx
      .select({ jobId: relayOutboxJobTargets.jobId })
      .from(relayOutboxJobTargets)
      .where(eq(relayOutboxJobTargets.jobId, job.id))
      .limit(1)
      .get();
    if (!remaining) await tx.delete(relayOutboxJobs).where(eq(relayOutboxJobs.id, job.id));
    if (durable) await this.recomputeMessageStatus(tx, job);
  }

  private async failBeforePublish(
    job: RelayJob,
    durable: boolean,
    reason: string,
    removePendingTargets = false,
  ): Promise<void> {
    await this.serializeMessageWrite(job, async () => {
      await db.transaction(async (tx) => {
        if (durable && removePendingTargets) {
          const targets = await tx
            .select()
            .from(relayOutboxJobTargets)
            .where(eq(relayOutboxJobTargets.jobId, job.id))
            .all();
          const byRecipient = new Map<string, Set<string>>();
          for (const target of targets) {
            const urls = byRecipient.get(target.recipientPubkey) ?? new Set<string>();
            urls.add(target.relayUrl);
            byRecipient.set(target.recipientPubkey, urls);
          }
          for (const [recipientPubkey, urls] of byRecipient) {
            const copy = await tx
              .select({ relays: messageDeliveryCopies.relays })
              .from(messageDeliveryCopies)
              .where(
                and(
                  eq(messageDeliveryCopies.accountPubkey, job.accountPubkey),
                  eq(messageDeliveryCopies.messageId, job.messageId),
                  eq(messageDeliveryCopies.recipientPubkey, recipientPubkey),
                ),
              )
              .get();
            if (!copy) continue;
            const relays = copy.relays.filter(
              (relay) => relay.status !== 'pending' || !urls.has(relay.url),
            );
            if (relays.length === 0) {
              await tx
                .delete(messageDeliveryCopies)
                .where(
                  and(
                    eq(messageDeliveryCopies.accountPubkey, job.accountPubkey),
                    eq(messageDeliveryCopies.messageId, job.messageId),
                    eq(messageDeliveryCopies.recipientPubkey, recipientPubkey),
                  ),
                );
            } else {
              await tx
                .update(messageDeliveryCopies)
                .set({ relays, updatedAt: nowSeconds() })
                .where(
                  and(
                    eq(messageDeliveryCopies.accountPubkey, job.accountPubkey),
                    eq(messageDeliveryCopies.messageId, job.messageId),
                    eq(messageDeliveryCopies.recipientPubkey, recipientPubkey),
                  ),
                );
            }
          }
        }
        await tx.delete(relayOutboxJobs).where(eq(relayOutboxJobs.id, job.id));
        if (!durable) return;
        const otherJob = await tx
          .select({ id: relayOutboxJobs.id })
          .from(relayOutboxJobs)
          .where(
            and(
              eq(relayOutboxJobs.accountPubkey, job.accountPubkey),
              eq(relayOutboxJobs.messageId, job.messageId),
            ),
          )
          .limit(1)
          .get();
        const message = await tx
          .select({ deliveryStatus: messages.deliveryStatus })
          .from(messages)
          .where(
            and(
              eq(messages.accountPubkey, job.accountPubkey),
              eq(messages.id, job.messageId),
            ),
          )
          .get();
        if (message?.deliveryStatus !== 'sent') {
          await tx
            .update(messages)
            .set({
              deliveryStatus: otherJob ? 'queued' : 'failed',
              deliveryError: reason,
            })
            .where(
              and(
                eq(messages.accountPubkey, job.accountPubkey),
                eq(messages.id, job.messageId),
              ),
            );
        }
      });
    });
  }

  private async finishEmptyJob(job: RelayJob, durable: boolean): Promise<void> {
    await this.serializeMessageWrite(job, async () => {
      await db.transaction(async (tx) => {
        await tx.delete(relayOutboxJobs).where(eq(relayOutboxJobs.id, job.id));
        if (durable) await this.recomputeMessageStatus(tx, job);
      });
    });
  }

  private async recomputeMessageStatus(
    tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
    job: RelayJob,
  ): Promise<void> {
    const message = await tx
      .select({ deliveryStatus: messages.deliveryStatus })
      .from(messages)
      .where(
        and(
          eq(messages.accountPubkey, job.accountPubkey),
          eq(messages.id, job.messageId),
        ),
      )
      .get();
    if (!message || message.deliveryStatus === 'sent') return;

    const copies = await tx
      .select()
      .from(messageDeliveryCopies)
      .where(
        and(
          eq(messageDeliveryCopies.accountPubkey, job.accountPubkey),
          eq(messageDeliveryCopies.messageId, job.messageId),
        ),
      )
      .all();
    const nonSelf = copies.filter((copy) => copy.recipientPubkey !== job.accountPubkey);
    const surfaced = nonSelf.length > 0 ? nonSelf : copies;
    const relays = surfaced.flatMap((copy) => copy.relays);
    const ok = relays.filter((relay) => relay.status === 'ok').length;
    const verdict = relayDeliveryVerdict(ok, relays.length);
    const remainingJob = await tx
      .select({ id: relayOutboxJobs.id })
      .from(relayOutboxJobs)
      .where(
        and(
          eq(relayOutboxJobs.accountPubkey, job.accountPubkey),
          eq(relayOutboxJobs.messageId, job.messageId),
        ),
      )
      .limit(1)
      .get();
    const deliveryStatus = verdict === 'sent' ? 'sent' : remainingJob ? 'queued' : 'failed';
    await tx
      .update(messages)
      .set({ deliveryStatus, deliveryError: deliveryStatus === 'sent' ? null : undefined })
      .where(
        and(
          eq(messages.accountPubkey, job.accountPubkey),
          eq(messages.id, job.messageId),
        ),
      );
  }

  private serializeMessageWrite(job: RelayJob, write: () => Promise<void>): Promise<void> {
    const key = `${job.accountPubkey}\n${job.messageId}`;
    const previous = this.messageWrites.get(key) ?? Promise.resolve();
    const next = previous.catch(() => {}).then(write);
    this.messageWrites.set(key, next);
    void next.then(
      () => {
        if (this.messageWrites.get(key) === next) this.messageWrites.delete(key);
      },
      () => {
        if (this.messageWrites.get(key) === next) this.messageWrites.delete(key);
      },
    );
    return next;
  }
}

export const relayMessageOutbox = new RelayMessageOutbox();
