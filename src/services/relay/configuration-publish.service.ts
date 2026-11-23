import { isNewerEvent as newer } from '@/lib/nostr/event-version';
import { and, asc, eq, gt, lte, sql } from 'drizzle-orm';
import { getEventHash, type Event, type EventTemplate } from 'nostr-tools';

import { db, type Database } from '@/db/client';
import { configurationOutbox, contactSyncState, privateListSyncState, replaceableEvents, routingSettingsEdits } from '@/db/schema';
import { platform } from '@/platform';
import { normalizeRelayUrl, normalizeRelayUrls } from '@/lib/nostr/relay-url';

import type { Signer } from '../signer/signer.interface';
import { MAX_RELAY_RETRY_TIMER_MS, RELAY_RATE_LIMIT_BACKOFF_MS, relayRetryDeadline } from './publish-retry';
import { relayPool } from './relay-pool';
import { configurationPublishRelays, parseRelayListMetadata } from './relay-router';
import { prepareWriteRelayConfiguration } from './relay-configuration-template';
import { isRoutingSettingsKind, persistRoutingSettingsEvent, readRoutingSettingsEdit, routingSettingsSlot } from './routing-settings-edits';
import { invalidateReplaceableEvent } from './replaceable-events.service';

const RETRY_DELAYS_MS = [1_000, 2_000, 5_000, 10_000, 30_000, 60_000];
const BATCH_SIZE = 4;
const SETTINGS_DEBOUNCE_MS = 2_000;
const PUBLISH_TIMEOUT_MS = 10_000;
type PendingConfiguration = typeof configurationOutbox.$inferSelect;
type SettingsEdit = typeof routingSettingsEdits.$inferSelect;
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

async function readPending(key: Coordinate, tx: Database = db, includeStopped = false) {
  return (await tx.select().from(configurationOutbox).where(and(
    slot(key), includeStopped ? undefined : eq(configurationOutbox.stopped, false),
  )).limit(1))[0];
}

async function readCached(key: Coordinate, tx: Database = db) {
  return (await tx.select({ event: replaceableEvents.event }).from(replaceableEvents).where(and(
    eq(replaceableEvents.pubkey, key.accountPubkey), eq(replaceableEvents.kind, key.kind),
    eq(replaceableEvents.dTag, key.dTag),
  )).limit(1))[0]?.event ?? null;
}


/** Durable handoff: cache and pending publication commit together. A late older
 * snapshot cannot replace newer work, and acknowledgements belong to event IDs. */
export async function enqueueConfigurationEvent(
  event: Event, commit?: ConfigurationCommit, expectedPreviousEventId?: string | null, settingsRevision?: number,
): Promise<boolean> {
  const key = coordinate(event.pubkey, event);
  const accepted = await db.transaction(async (tx) => {
    if (isRoutingSettingsKind(key.kind)) {
      const edit = await readRoutingSettingsEdit(key.accountPubkey, key.kind, tx);
      if (edit?.revision !== settingsRevision) return false;
    }
    const pending = await readPending(key, tx, true);
    const cached = await readCached(key, tx);
    // Partial configuration edits must not erase a concurrent remote update.
    if (expectedPreviousEventId !== undefined && (cached?.id ?? null) !== expectedPreviousEventId) {
      throw new Error('Configuration changed while saving. Please try again.');
    }
    if (pending?.eventId === event.id) return !pending.stopped;
    if ((pending && !newer(event, pending.event)) || (cached && newer(cached, event))) return false;
    const now = Date.now();
    const previousWriteRelays = key.kind === 10002 && settingsRevision !== undefined && cached
      ? parseRelayListMetadata(cached).write
      : [];
    const payload = { eventId: event.id, event, previousWriteRelays, nextAttemptAt: now };
    await tx.insert(configurationOutbox).values({
      ...key, ...payload,
    }).onConflictDoUpdate({
      target: [configurationOutbox.accountPubkey, configurationOutbox.kind, configurationOutbox.dTag],
      set: {
        ...payload, acknowledgedRelays: [], rejectedRelays: [], retryNotBefore: 0, stopped: false,
        attempts: 0, lastError: null,
      },
    });
    await tx.insert(replaceableEvents).values({
      pubkey: event.pubkey, kind: key.kind, dTag: key.dTag, event,
      createdAt: event.created_at, fetchedAt: Math.floor(now / 1000),
    }).onConflictDoUpdate({
      target: [replaceableEvents.pubkey, replaceableEvents.kind, replaceableEvents.dTag],
      set: { event, relays: [], createdAt: event.created_at, fetchedAt: Math.floor(now / 1000) },
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

/** Commit the local choice and replace any obsolete publication atomically. */
export async function saveRoutingSettings(accountPubkey: string, kind: number, urls: string[]): Promise<void> {
  if (!isRoutingSettingsKind(kind) || urls.length === 0) throw new Error('Invalid routing settings edit.');
  const key = coordinate(accountPubkey, { kind, tags: [] });
  const now = Date.now();
  const editedAt = Math.floor(now / 1000);
  const nextAttemptAt = now + SETTINGS_DEBOUNCE_MS;
  await db.transaction(async (tx) => {
    await tx.insert(routingSettingsEdits).values({
      accountPubkey, kind, urls, revision: 1, editedAt, nextAttemptAt,
    }).onConflictDoUpdate({
      target: [routingSettingsEdits.accountPubkey, routingSettingsEdits.kind],
      set: { urls, revision: sql`${routingSettingsEdits.revision} + 1`, editedAt, attempts: 0, nextAttemptAt },
    });
    await tx.delete(configurationOutbox).where(slot(key));
  });
  configurationPublisher.wake();
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
  if (kind >= 30000 && kind < 40000) {
    const [state] = await tx.select({ dirty: privateListSyncState.dirty }).from(privateListSyncState)
      .where(and(eq(privateListSyncState.accountPubkey, accountPubkey), eq(privateListSyncState.kind, kind), eq(privateListSyncState.dTag, dTag)))
      .limit(1);
    if (state?.dirty) return false;
  }
  if (preparationJobs.has(JSON.stringify([accountPubkey, kind, dTag]))) return false;
  const key = { accountPubkey, kind, dTag };
  if (isRoutingSettingsKind(kind) && await readRoutingSettingsEdit(accountPubkey, kind, tx)) return false;
  const pending = await readPending(key, tx);
  if (pending && (!isRoutingSettingsKind(kind) || !newer(event, pending.event))) return false;
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
  private session: { pubkey: string; abort: AbortController; onRoutingChanged?: (kind: number) => void } | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private observed = false;
  private online = true;
  private running = false;
  private requested = false;

  start(accountPubkey: string, onRoutingChanged?: (kind: number) => void): void {
    this.stop();
    this.session = { pubkey: accountPubkey, abort: new AbortController(), onRoutingChanged };
    if (!this.observed) {
      this.observed = true;
      platform.networkState.addStateListener((state) => {
        const wasOnline = this.online;
        this.online = state.isConnected !== false;
        if (!this.online) this.clearTimer();
        else if (!wasOnline || state.isInternetReachable === true) this.wake(true);
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
      const now = Date.now();
      void Promise.all([
        db.update(configurationOutbox).set({ nextAttemptAt: now })
          .where(and(eq(configurationOutbox.accountPubkey, session.pubkey),
            eq(configurationOutbox.stopped, false), lte(configurationOutbox.retryNotBefore, now))),
        db.update(routingSettingsEdits).set({ nextAttemptAt: now }).where(and(
          eq(routingSettingsEdits.accountPubkey, session.pubkey), gt(routingSettingsEdits.attempts, 0),
        )),
      ]).then(() => { if (this.session === session) this.wake(); })
        .catch((error) => { console.warn('[config-publish] Could not resume pending work.', error); this.schedule(60_000); });
      return;
    }
    this.requested = true;
    if (this.canRun() && !this.running) this.schedule(0);
  }

  private schedule(delayMs: number): void {
    this.clearTimer();
    if (!this.canRun()) return;
    this.timer = setTimeout(() => { this.timer = null; void this.flush(); }, Math.min(delayMs, MAX_RELAY_RETRY_TIMER_MS));
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
        eq(configurationOutbox.stopped, false),
        lte(configurationOutbox.nextAttemptAt, Date.now()),
      )).orderBy(asc(configurationOutbox.nextAttemptAt)).limit(BATCH_SIZE);
      const edits = await db.select().from(routingSettingsEdits).where(and(
        eq(routingSettingsEdits.accountPubkey, session.pubkey),
        lte(routingSettingsEdits.nextAttemptAt, Date.now()),
      ));
      await Promise.all([
        ...rows.map((row) => this.deliver(row, session)),
        ...edits.map((edit) => this.signSettingsEdit(edit, session)),
      ]);
      const [next] = await db.select({ at: configurationOutbox.nextAttemptAt }).from(configurationOutbox)
        .where(and(eq(configurationOutbox.accountPubkey, session.pubkey), eq(configurationOutbox.stopped, false)))
        .orderBy(asc(configurationOutbox.nextAttemptAt)).limit(1);
      const [nextEdit] = await db.select({ at: routingSettingsEdits.nextAttemptAt }).from(routingSettingsEdits)
        .where(eq(routingSettingsEdits.accountPubkey, session.pubkey))
        .orderBy(asc(routingSettingsEdits.nextAttemptAt)).limit(1);
      const nextAt = Math.min(next?.at ?? Infinity, nextEdit?.at ?? Infinity);
      delay = Number.isFinite(nextAt) ? Math.max(0, nextAt - Date.now()) : -1;
    } catch (error) {
      console.warn('[config-publish] Pending publication failed.', error);
    } finally {
      this.running = false;
      if (this.requested) this.schedule(0);
      else if (delay >= 0 && this.session === session) this.schedule(delay);
    }
  }

  private async retireSupersededRouting(
    key: Coordinate, version: Pick<Event, 'created_at' | 'id'>,
    session: NonNullable<ConfigurationPublisher['session']>, edit?: SettingsEdit,
  ): Promise<boolean> {
    if (!isRoutingSettingsKind(key.kind)) return false;
    const retired = await db.transaction(async tx => {
      if (this.session !== session) return false;
      const cached = await readCached(key, tx);
      if (!cached || !newer(cached, version)) return false;
      if (edit) {
        if ((await readRoutingSettingsEdit(key.accountPubkey, key.kind, tx))?.revision !== edit.revision) return false;
        await tx.delete(routingSettingsEdits).where(routingSettingsSlot(key.accountPubkey, key.kind));
      } else {
        const pending = await readPending(key, tx);
        if (!pending || pending.eventId !== version.id) return false;
        await tx.delete(configurationOutbox).where(exact(pending));
      }
      await persistRoutingSettingsEvent(cached, tx);
      return true;
    });
    if (retired && this.session === session) session.onRoutingChanged?.(key.kind);
    return retired;
  }

  private async signSettingsEdit(edit: SettingsEdit, session: NonNullable<ConfigurationPublisher['session']>) {
    const { accountPubkey, kind, urls, revision, editedAt } = edit;
    const key = { accountPubkey, kind, dTag: '' };
    const current = () => this.session === session && !session.abort.signal.aborted;
    let signer: Signer | undefined;
    let version: Pick<Event, 'created_at' | 'id'> | undefined;
    try {
      const snapshot = kind === 10002
        ? await prepareWriteRelayConfiguration(accountPubkey, urls, editedAt)
        : {
          template: {
            kind, content: '', created_at: editedAt,
            tags: urls.map(url => [kind === 10050 ? 'relay' : 'server', url]),
          },
          previousEventId: undefined,
        };
      if (!current() || (await readRoutingSettingsEdit(accountPubkey, kind))?.revision !== revision) return;
      version = { created_at: editedAt, id: getEventHash({ ...snapshot.template, pubkey: accountPubkey }) };
      if (await this.retireSupersededRouting(key, version, session, edit) || !current()) return;

      // eslint-disable-next-line @typescript-eslint/no-require-imports -- initialize the signer transport only when signing is due
      const { buildSigner } = require('../account/account-access') as typeof import('../account/account-access');
      signer = await buildSigner(accountPubkey);
      if (!current()) return;
      const event = await signer.signEvent(snapshot.template);
      if (event.pubkey !== accountPubkey || event.kind !== kind || event.created_at !== editedAt) {
        throw new Error('Configuration signature does not match the edit.');
      }
      version = event;
      const queued = await enqueueConfigurationEvent(event, async (_event, tx) => {
        if (!current()) throw new Error('Configuration publication was cancelled.');
        await persistRoutingSettingsEvent(event, tx);
        await tx.delete(routingSettingsEdits).where(routingSettingsSlot(accountPubkey, kind));
      }, snapshot.previousEventId, revision);
      if (!queued) throw new Error('Configuration was superseded while signing.');
    } catch (error) {
      if (!current() || (await readRoutingSettingsEdit(accountPubkey, kind))?.revision !== revision) return;
      // A newer timestamp wins even if the read failed before the draft acquired an ID.
      const draftVersion = version ?? { created_at: editedAt, id: '' };
      if (await this.retireSupersededRouting(key, draftVersion, session, edit)) return;
      const delay = RETRY_DELAYS_MS[Math.min(edit.attempts, RETRY_DELAYS_MS.length - 1)];
      await db.update(routingSettingsEdits).set({
        attempts: edit.attempts + 1, nextAttemptAt: Date.now() + delay,
      }).where(and(routingSettingsSlot(accountPubkey, kind), eq(routingSettingsEdits.revision, revision)));
      console.warn('[config-publish] Could not sign routing settings.', error);
    } finally {
      try { await signer?.destroy?.(); } catch { /* The handoff has already settled. */ }
    }
  }

  private async deliver(row: PendingConfiguration, session: NonNullable<ConfigurationPublisher['session']>) {
    const current = () => this.session === session && !session.abort.signal.aborted;
    const acknowledged = new Set(normalizeRelayUrls(row.acknowledgedRelays));
    const rejected = new Set(normalizeRelayUrls(row.rejectedRelays));
    let rateLimitDelay = 0;
    let exhausted = false;
    let failure = 'The current relay targets have not reached a publication quorum.';
    try {
      const targets = await configurationPublishRelays(row.event);
      const remaining = normalizeRelayUrls([...targets, ...row.previousWriteRelays])
        .filter(url => !acknowledged.has(url) && !rejected.has(url));
      if (!current()) return;
      // Replacement may have landed while routing was resolving.
      if ((await readPending(row))?.eventId !== row.eventId || !current()) return;
      if (await this.retireSupersededRouting(row, row.event, session) || !current()) return;
      if (targets.filter((url) => acknowledged.has(normalizeRelayUrl(url))).length < configurationPublishQuorum(targets.length) && remaining.length > 0) {
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
          if (result.outcome.ok) acknowledged.add(normalizeRelayUrl(result.url));
          else {
            failure = result.outcome.reason;
            if (result.outcome.failure === 'rejected') rejected.add(normalizeRelayUrl(result.url));
            if (result.outcome.failure === 'rate-limited') {
              rateLimitDelay = Math.max(rateLimitDelay, RELAY_RATE_LIMIT_BACKOFF_MS, result.outcome.retryAfterMs ?? 0);
            }
          }
        }
      }
      if (!current()) return;
      // Settings can change while a publish is awaiting acknowledgements.
      const currentTargets = await configurationPublishRelays(row.event);
      if (!current() || await this.retireSupersededRouting(row, row.event, session)) return;
      if (currentTargets.filter((url) => acknowledged.has(normalizeRelayUrl(url))).length >= configurationPublishQuorum(currentTargets.length)) {
        if (rejected.size > 0) {
          await db.update(configurationOutbox).set({
            stopped: true, acknowledgedRelays: [...acknowledged], rejectedRelays: [...rejected], lastError: null,
          }).where(exact(row));
        } else {
          await db.delete(configurationOutbox).where(exact(row));
        }
        return;
      }
      exhausted = currentTargets.length > 0 && currentTargets.every(url =>
        acknowledged.has(normalizeRelayUrl(url)) || rejected.has(normalizeRelayUrl(url)));
    } catch (error) {
      failure = error instanceof Error ? error.message : String(error);
    }
    if (!current()) return;
    if (rateLimitDelay === 0 && row.kind === 30000 && ['psstpsst-contacts', 'psstpsst-muted', 'psstpsst-blocked'].includes(row.dTag)) {
      // This list can always be rebuilt from local plaintext. Retire a failed
      // delivery; the next edit creates a new event instead of retrying ciphertext.
      await db.transaction(async (tx) => {
        if ((await readPending(row, tx))?.eventId !== row.eventId) return;
        await tx.delete(configurationOutbox).where(exact(row));
        if (row.dTag === 'psstpsst-contacts') {
          await tx.update(contactSyncState).set({ dirty: true }).where(and(
            eq(contactSyncState.accountPubkey, row.accountPubkey),
            eq(contactSyncState.eventId, row.eventId),
          ));
        } else {
          await tx.insert(privateListSyncState).values({
            accountPubkey: row.accountPubkey, kind: row.kind, dTag: row.dTag, dirty: true, eventId: row.eventId,
          }).onConflictDoUpdate({
            target: [privateListSyncState.accountPubkey, privateListSyncState.kind, privateListSyncState.dTag],
            set: { dirty: true },
            setWhere: eq(privateListSyncState.eventId, row.eventId),
          });
        }
      });
      return;
    }
    const delay = RETRY_DELAYS_MS[Math.min(row.attempts, RETRY_DELAYS_MS.length - 1)];
    const now = Date.now();
    const retryNotBefore = rateLimitDelay > 0 ? relayRetryDeadline(now, rateLimitDelay) : 0;
    await db.update(configurationOutbox).set({
      acknowledgedRelays: [...acknowledged], rejectedRelays: [...rejected], attempts: row.attempts + 1,
      stopped: exhausted, retryNotBefore, nextAttemptAt: Math.max(now + delay, retryNotBefore), lastError: failure,
    }).where(exact(row));
  }
}

export const configurationPublisher = new ConfigurationPublisher();
