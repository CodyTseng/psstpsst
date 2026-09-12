import { and, asc, eq, lte } from 'drizzle-orm';
import type { Event, EventTemplate } from 'nostr-tools';

import { db, type Database } from '@/db/client';
import { configurationOutbox, replaceableEvents } from '@/db/schema';
import { platform } from '@/platform';

import type { Signer } from '../signer/signer.interface';
import { relayPool } from './relay-pool';
import { configurationPublishRelays } from './relay-router';
import { invalidateReplaceableEvent } from './replaceable-events.service';

const RETRY_DELAYS_MS = [1_000, 2_000, 5_000, 10_000, 30_000, 60_000];
const BATCH_SIZE = 4;
const PUBLISH_TIMEOUT_MS = 10_000;
type PendingConfiguration = typeof configurationOutbox.$inferSelect;
type Coordinate = { accountPubkey: string; kind: number; dTag: string };
type ConfigurationCommit = (event: Event, tx: Database) => Promise<void>;

function coordinate(accountPubkey: string, event: Pick<Event, 'kind' | 'tags'>): Coordinate {
  const { kind } = event;
  if (kind !== 0 && kind !== 3 && !(kind >= 10000 && kind < 20000) && !(kind >= 30000 && kind < 40000)) {
    throw new Error('Only replaceable configuration events can be queued.');
  }
  return { accountPubkey, kind, dTag: kind >= 30000 ? event.tags.find((tag) => tag[0] === 'd')?.[1] ?? '' : '' };
}

function slot(key: Coordinate) {
  return and(eq(configurationOutbox.accountPubkey, key.accountPubkey),
    eq(configurationOutbox.kind, key.kind), eq(configurationOutbox.dTag, key.dTag));
}

function exact(row: PendingConfiguration) {
  return and(slot(row), eq(configurationOutbox.eventId, row.eventId));
}

async function readPending(key: Coordinate, tx: Database = db) {
  return (await tx.select().from(configurationOutbox).where(slot(key)).limit(1))[0];
}

async function readCached(key: Coordinate, tx: Database = db) {
  return (await tx.select({ event: replaceableEvents.event }).from(replaceableEvents).where(and(
    eq(replaceableEvents.pubkey, key.accountPubkey), eq(replaceableEvents.kind, key.kind),
    eq(replaceableEvents.dTag, key.dTag),
  )).limit(1))[0]?.event ?? null;
}

function newer(a: Event, b: Event): boolean {
  return a.created_at > b.created_at || (a.created_at === b.created_at && a.id < b.id);
}

/** Durable handoff: cache and pending publication commit together. A late older
 * snapshot cannot replace newer work, and acknowledgements belong to event IDs. */
export async function enqueueConfigurationEvent(event: Event, commit?: ConfigurationCommit, expectedPreviousEventId?: string | null): Promise<boolean> {
  const key = coordinate(event.pubkey, event);
  const accepted = await db.transaction(async (tx) => {
    const pending = await readPending(key, tx);
    const cached = await readCached(key, tx);
    // Partial configuration edits must not erase a concurrent remote update.
    if (expectedPreviousEventId !== undefined && (cached?.id ?? null) !== expectedPreviousEventId) {
      throw new Error('Configuration changed while saving. Please try again.');
    }
    if (pending?.eventId === event.id) return true;
    if ((pending && !newer(event, pending.event)) || (cached && newer(cached, event))) return false;
    const now = Date.now();
    await tx.insert(configurationOutbox).values({
      ...key, eventId: event.id, event, nextAttemptAt: now,
    }).onConflictDoUpdate({
      target: [configurationOutbox.accountPubkey, configurationOutbox.kind, configurationOutbox.dTag],
      set: { eventId: event.id, event, acknowledgedRelays: [], attempts: 0, nextAttemptAt: now, lastError: null },
    });
    await tx.insert(replaceableEvents).values({
      pubkey: event.pubkey, kind: key.kind, dTag: key.dTag, event,
      createdAt: event.created_at, fetchedAt: Math.floor(now / 1000),
    }).onConflictDoUpdate({
      target: [replaceableEvents.pubkey, replaceableEvents.kind, replaceableEvents.dTag],
      set: { event, createdAt: event.created_at, fetchedAt: Math.floor(now / 1000) },
    });
    await commit?.(event, tx);
    return true;
  });
  if (accepted) {
    invalidateReplaceableEvent({ pubkey: event.pubkey, kind: key.kind, dTag: key.dTag });
    configurationPublisher.wake();
  }
  return accepted;
}

const signingJobs = new Map<string, Promise<unknown>>();
const preparationJobs = new Map<string, Promise<unknown>>();

/** Serialize snapshot reads and encryption too, so a slow older encryption
 * cannot enqueue stale list contents after a newer edit. Yield before crypto. */
export function prepareConfiguration<T>(
  accountPubkey: string, kind: number, dTag: string, task: () => Promise<T>,
): Promise<T> {
  const id = JSON.stringify([accountPubkey, kind, dTag]);
  const previous = preparationJobs.get(id) ?? Promise.resolve();
  const job = previous.catch(() => {}).then(async () => {
    if (platform.appState.currentState() === 'active') await new Promise((resolve) => setTimeout(resolve, 0));
    return task();
  });
  preparationJobs.set(id, job);
  const clear = () => { if (preparationJobs.get(id) === job) preparationJobs.delete(id); };
  void job.then(clear, clear);
  return job;
}

/** Serialize local snapshots per coordinate and give same-second edits strictly
 * increasing timestamps. Network delivery never holds this serialization lock. */
export function publishConfiguration(
  accountPubkey: string,
  signer: Signer,
  template: EventTemplate,
  commit?: ConfigurationCommit,
  expectedPreviousEventId?: string | null,
): Promise<Event> {
  const key = coordinate(accountPubkey, template);
  const id = JSON.stringify(key);
  const previous = signingJobs.get(id) ?? Promise.resolve();
  const job = previous.catch(() => {}).then(async () => {
    // Signing can be CPU-bound even when its interface returns a promise.
    if (platform.appState.currentState() === 'active') await new Promise((resolve) => setTimeout(resolve, 0));
    const [pending, cached] = await Promise.all([readPending(key), readCached(key)]);
    const event = await signer.signEvent({
      ...template,
      created_at: Math.max(template.created_at, Math.floor(Date.now() / 1000),
        (pending?.event.created_at ?? 0) + 1, (cached?.created_at ?? 0) + 1),
    });
    if (event.pubkey !== accountPubkey) throw new Error('Configuration signer does not match the account.');
    if (!(await enqueueConfigurationEvent(event, commit, expectedPreviousEventId))) throw new Error('Configuration was superseded while signing.');
    return event;
  });
  signingJobs.set(id, job);
  const clear = () => { if (signingJobs.get(id) === job) signingJobs.delete(id); };
  void job.then(clear, clear);
  return job;
}

/** Read through services/hooks; absent means no outstanding signed snapshot. */
export async function getPendingConfiguration(accountPubkey: string, kind: number, dTag = '', tx: Database = db) {
  return (await readPending({ accountPubkey, kind, dTag }, tx)) ?? null;
}

/** Private-list reconciliation may have awaited decryption while a local edit
 * was being prepared, queued, or acknowledged. Check again in its transaction. */
export async function canApplyConfigurationEvent(
  accountPubkey: string, kind: number, dTag: string, event: Event, tx: Database = db,
): Promise<boolean> {
  if (preparationJobs.has(JSON.stringify([accountPubkey, kind, dTag]))) return false;
  const key = { accountPubkey, kind, dTag };
  if (await readPending(key, tx)) return false;
  const cached = await readCached(key, tx);
  return !cached || !newer(cached, event);
}

/** Strict majority of the current, deduplicated routing targets. */
export function configurationPublishQuorum(totalRelays: number): number {
  return Math.floor(totalRelays / 2) + 1;
}

/** One active-account worker, independent of DM readiness. Persisted deadlines
 * survive restarts; foreground/network recovery wakes outstanding work early. */
export class ConfigurationPublisher {
  private session: { pubkey: string; abort: AbortController } | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private observed = false;
  private online = true;
  private running = false;
  private requested = false;

  start(accountPubkey: string): void {
    this.stop();
    this.session = { pubkey: accountPubkey, abort: new AbortController() };
    if (!this.observed) {
      this.observed = true;
      platform.networkState.addStateListener((state) => {
        const wasOnline = this.online;
        this.online = state.isConnected !== false && state.isInternetReachable !== false;
        if (!this.online) this.clearTimer();
        else if (!wasOnline) this.wake(true);
      });
      platform.appState.addChangeListener((state) => {
        if (state === 'active') this.wake(true);
        else this.clearTimer();
      });
    }
    this.wake(true);
  }

  stop(accountPubkey?: string): void {
    if (accountPubkey && this.session?.pubkey !== accountPubkey) return;
    this.session?.abort.abort();
    this.session = null;
    this.clearTimer();
  }

  private clearTimer(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  private canRun(): boolean {
    return this.session != null && this.online && platform.appState.currentState() === 'active';
  }

  wake(retryNow = false): void {
    const session = this.session;
    if (!session) return;
    if (retryNow) {
      void db.update(configurationOutbox).set({ nextAttemptAt: Date.now() })
        .where(eq(configurationOutbox.accountPubkey, session.pubkey))
        .then(() => { if (this.session === session) this.wake(); })
        .catch((error) => { console.warn('[config-publish] Could not resume pending work.', error); this.schedule(60_000); });
      return;
    }
    this.requested = true;
    if (this.canRun() && !this.running) this.schedule(0);
  }

  private schedule(delayMs: number): void {
    this.clearTimer();
    if (!this.canRun()) return;
    this.timer = setTimeout(() => { this.timer = null; void this.flush(); }, delayMs);
  }

  /** Bounded batch; also exposed for deterministic service integration tests. */
  async flush(): Promise<void> {
    if (this.running || !this.canRun()) return;
    const session = this.session!;
    this.running = true;
    this.requested = false;
    let delay = 60_000;
    try {
      const rows = await db.select().from(configurationOutbox).where(and(
        eq(configurationOutbox.accountPubkey, session.pubkey),
        lte(configurationOutbox.nextAttemptAt, Date.now()),
      )).orderBy(asc(configurationOutbox.nextAttemptAt)).limit(BATCH_SIZE);
      await Promise.all(rows.map((row) => this.deliver(row, session)));
      const [next] = await db.select({ at: configurationOutbox.nextAttemptAt }).from(configurationOutbox)
        .where(eq(configurationOutbox.accountPubkey, session.pubkey))
        .orderBy(asc(configurationOutbox.nextAttemptAt)).limit(1);
      delay = next ? Math.max(0, next.at - Date.now()) : -1;
    } catch (error) {
      console.warn('[config-publish] Pending publication failed.', error);
    } finally {
      this.running = false;
      if (this.requested) this.schedule(0);
      else if (delay >= 0 && this.session === session) this.schedule(delay);
    }
  }

  private async deliver(row: PendingConfiguration, session: NonNullable<ConfigurationPublisher['session']>) {
    const current = () => this.session === session && !session.abort.signal.aborted;
    const acknowledged = new Set(row.acknowledgedRelays);
    let failure = 'The current relay targets have not reached a publication quorum.';
    try {
      const targets = await configurationPublishRelays(row.event);
      const remaining = targets.filter((url) => !acknowledged.has(url));
      if (!current()) return;
      // Replacement may have landed while routing was resolving.
      if ((await readPending(row))?.eventId !== row.eventId || !current()) return;
      if (targets.filter((url) => acknowledged.has(url)).length < configurationPublishQuorum(targets.length) && remaining.length > 0) {
        let signer: Promise<Signer> | undefined;
        const results = await relayPool.publishEvent({
          relays: remaining, event: row.event, timeoutMs: PUBLISH_TIMEOUT_MS, abort: session.abort.signal,
          signAuth: (template) => {
            if (!current()) throw new Error('Configuration publication was cancelled.');
            signer ??= import('../account/account.service').then(({ buildSigner }) => buildSigner(row.accountPubkey));
            return signer.then((value) => value.signEvent(template));
          },
        });
        for (const result of results) {
          if (result.outcome.ok) acknowledged.add(result.url);
          else failure = result.outcome.reason;
        }
      }
      if (!current()) return;
      // Settings can change while a publish is awaiting acknowledgements.
      const currentTargets = await configurationPublishRelays(row.event);
      if (!current()) return;
      if (currentTargets.filter((url) => acknowledged.has(url)).length >= configurationPublishQuorum(currentTargets.length)) {
        await db.delete(configurationOutbox).where(exact(row));
        return;
      }
    } catch (error) {
      failure = error instanceof Error ? error.message : String(error);
    }
    if (!current()) return;
    const delay = RETRY_DELAYS_MS[Math.min(row.attempts, RETRY_DELAYS_MS.length - 1)];
    await db.update(configurationOutbox).set({
      acknowledgedRelays: [...acknowledged], attempts: row.attempts + 1,
      nextAttemptAt: Date.now() + delay, lastError: failure,
    }).where(exact(row));
  }
}

export const configurationPublisher = new ConfigurationPublisher();
