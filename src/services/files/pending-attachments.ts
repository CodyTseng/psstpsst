import { and, eq } from 'drizzle-orm';
import { createStore } from 'zustand/vanilla';

import { db } from '@/db/client';
import { pendingAttachments } from '@/db/schema';
import {
  deletePendingAttachmentFile,
  pendingAttachmentFileExists,
  pendingAttachmentUri,
  stagePendingAttachmentFile,
} from '@/services/files/pending-attachment-file.service';
import type { ImageSendQuality } from '@/lib/attachments/image-quality';
import { validMediaDimensions, type MediaDimensions } from '@/lib/attachments/media-dim';

/**
 * Pending attachments use an in-memory runtime model backed by SQLite metadata
 * and a staged source file in the persistent document directory. This keeps a
 * failed upload retryable after restart without putting binary data in SQLite.
 *
 * A confirmed attachment starts immediately: preparing → encrypting →
 * uploading → publishing → sent. The pre-publishing stages can move to
 * `paused` and resume; `publishing` begins gift-wrap persistence and closes the
 * cancellation window. Operational errors move to `failed` and can also retry.
 *
 * The `sent` step exists purely to avoid a flicker: we keep showing the local
 * bubble from the permanent local mirror until the real (live-query) bubble
 * for `sentRumorId` is on screen. Staging files are cleaned up immediately and
 * do not depend on that presentation handoff.
 */
export type PendingAttachmentStatus =
  | 'preparing'
  | 'encrypting'
  | 'uploading'
  | 'publishing'
  | 'paused'
  | 'sent'
  | 'failed';

export type PendingAttachment = {
  accountPubkey: string;
  tempId: string;
  conversationKey: string;
  localUri: string;
  /** Relative name inside the persistent pending-upload directory. */
  localName?: string;
  mime: string;
  width?: number;
  height?: number;
  /** Original filename (documents) — shown on the file-card bubble. */
  name?: string;
  /** Original size in bytes (documents) — shown on the file-card bubble. */
  size?: number;
  /** Voice messages: clip length in seconds (drives the in-flight voice bubble
   * width + the sent `duration` tag). */
  durationSec?: number;
  /** Voice messages: amplitude bars 0–100 (drawn while in flight, then sent as
   * the `waveform` tag). */
  waveform?: number[];
  imageQuality?: ImageSendQuality;
  /** Authenticated message ordering slot reserved when the batch is confirmed. */
  messageOrderAt?: number;
  status: PendingAttachmentStatus;
  /** Unix seconds — stamped when the item starts sending. Used to place the
   * in-flight bubble at the bottom of the message list. */
  startedAt?: number;
  /** Carried over from the chat-page reply state at send time. */
  replyToId?: string;
  /** Set when status === 'sent' — the id of the stored rumor. */
  sentRumorId?: string;
  /** Encrypted blob URL known before the rumor is stored. MessageList uses it
   * to replace this row atomically when the live DB message first appears. */
  uploadedUrl?: string;
  /** Only populated when status === 'failed'. */
  error?: string;
};

export type PendingAttachmentsState = {
  items: PendingAttachment[];
  /** Account whose pending rows are currently loaded. */
  account: string | null;
  loaded: boolean;
  load: (accountPubkey: string) => Promise<void>;
  /** Show attachments immediately, stage their durable source asynchronously,
   * and return only items that still exist when they are ready to upload. */
  enqueue: (items: PendingAttachment[]) => Promise<PendingAttachment[]>;
  removeOne: (tempId: string) => void;
  /** Re-arm a failed item for another attempt (Retry). */
  markSending: (
    tempId: string,
    opts: { startedAt: number; replyToId?: string },
  ) => void;
  setStatus: (
    tempId: string,
    status: 'encrypting' | 'uploading' | 'publishing',
  ) => void;
  markPaused: (tempId: string) => void;
  markUploaded: (tempId: string, url: string) => void;
  setDimensions: (tempId: string, dimensions: MediaDimensions) => void;
  markSent: (tempId: string, rumorId: string, localFile?: { uri: string; mime: string }) => void;
  markFailed: (tempId: string, error: string) => void;
};

export const PENDING_UPLOAD_INTERRUPTED = 'UPLOAD_INTERRUPTED';
let loadGeneration = 0;
let loadingSession: { accountPubkey: string; ids: Set<string> } | null = null;
const presentationReaders = new Map<string, number>();
const presentationKey = (accountPubkey: string, conversationKey: string) => `${accountPubkey}:${conversationKey}`;
const persistenceQueues = new Map<string, Promise<void>>();

function queuePersistence(item: PendingAttachment, operation: () => Promise<void>): void {
  const key = `${item.accountPubkey}\n${item.tempId}`;
  const previous = persistenceQueues.get(key) ?? Promise.resolve();
  const next = previous.catch(() => {}).then(operation).catch(() => {});
  persistenceQueues.set(key, next);
  void next.finally(() => {
    if (persistenceQueues.get(key) === next) persistenceQueues.delete(key);
  });
}

async function persistItem(item: PendingAttachment): Promise<void> {
  if (!item.localName) return;
  await db
    .insert(pendingAttachments)
    .values({
      accountPubkey: item.accountPubkey,
      tempId: item.tempId,
      conversationKey: item.conversationKey,
      localName: item.localName,
      mime: item.mime,
      width: item.width,
      height: item.height,
      name: item.name,
      size: item.size,
      durationSec: item.durationSec,
      waveform: item.waveform,
      imageQuality: item.imageQuality,
      messageOrderAt: item.messageOrderAt,
      status: item.status,
      startedAt: item.startedAt,
      replyToId: item.replyToId,
      error: item.error,
    })
    .onConflictDoUpdate({
      target: [pendingAttachments.accountPubkey, pendingAttachments.tempId],
      set: {
        conversationKey: item.conversationKey,
        localName: item.localName,
        mime: item.mime,
        width: item.width,
        height: item.height,
        name: item.name,
        size: item.size,
        durationSec: item.durationSec,
        waveform: item.waveform,
        imageQuality: item.imageQuality,
        messageOrderAt: item.messageOrderAt,
        status: item.status,
        startedAt: item.startedAt,
        replyToId: item.replyToId,
        error: item.error,
      },
    });
}

async function deletePersisted(item: Pick<PendingAttachment, 'accountPubkey' | 'tempId' | 'localName'>): Promise<void> {
  // Keep metadata until the file is gone so a failed delete or crash is recoverable.
  await deletePendingAttachmentFile(item.localName, true);
  await db.delete(pendingAttachments).where(and(
    eq(pendingAttachments.accountPubkey, item.accountPubkey),
    eq(pendingAttachments.tempId, item.tempId),
  ));
}

async function cleanupFinished(item: PendingAttachment): Promise<void> {
  // This terminal row is cleanup metadata, never a retryable outgoing message.
  await persistItem({ ...item, status: 'sent', error: undefined });
  await deletePersisted(item);
}

export const pendingAttachmentsStore = createStore<PendingAttachmentsState>((set, get) => ({
  items: [],
  account: null,
  loaded: false,
  load: async (accountPubkey) => {
    if (get().account === accountPubkey && get().loaded) return;
    const generation = ++loadGeneration;
    const session = {
      accountPubkey,
      ids: new Set(get().account === accountPubkey ? get().items.map((item) => item.tempId) : []),
    };
    loadingSession = session;
    try {
      const rows = await db
        .select()
        .from(pendingAttachments)
        .where(eq(pendingAttachments.accountPubkey, accountPubkey));
      const restored: PendingAttachment[] = [];
      for (const row of rows) {
        if (session.ids.has(row.tempId)) continue;
        if (row.status === 'sent') {
          await deletePersisted({ accountPubkey, tempId: row.tempId, localName: row.localName }).catch(() => {});
          continue;
        }
        const exists = await pendingAttachmentFileExists(row.localName);
        if (session.ids.has(row.tempId)) continue;
        if (!exists) {
          await db
            .delete(pendingAttachments)
            .where(
              and(
                eq(pendingAttachments.accountPubkey, accountPubkey),
                eq(pendingAttachments.tempId, row.tempId),
              ),
            )
            .catch(() => {});
          continue;
        }
        if (session.ids.has(row.tempId)) continue;
        const item: PendingAttachment = {
          accountPubkey,
          tempId: row.tempId,
          conversationKey: row.conversationKey,
          localUri: await pendingAttachmentUri(row.localName),
          localName: row.localName,
          mime: row.mime,
          width: row.width ?? undefined,
          height: row.height ?? undefined,
          name: row.name ?? undefined,
          size: row.size ?? undefined,
          durationSec: row.durationSec ?? undefined,
          waveform: row.waveform ?? undefined,
          imageQuality: row.imageQuality ?? undefined,
          messageOrderAt: row.messageOrderAt ?? undefined,
          status: 'failed',
          startedAt: row.startedAt ?? undefined,
          replyToId: row.replyToId ?? undefined,
          error: row.status === 'failed' ? (row.error ?? undefined) : PENDING_UPLOAD_INTERRUPTED,
        };
        if (session.ids.has(row.tempId)) continue;
        restored.push(item);
        if (row.status !== 'failed') queuePersistence(item, () => persistItem(item));
      }
      if (generation !== loadGeneration) return;
      set((current) => {
        if (current.account !== accountPubkey) {
          return { items: restored, account: accountPubkey, loaded: true };
        }
        const restoredIds = new Set(restored.map((item) => item.tempId));
        return {
          items: [...restored, ...current.items.filter((item) => !restoredIds.has(item.tempId))],
          account: accountPubkey,
          loaded: true,
        };
      });
    } finally {
      if (loadingSession === session) loadingSession = null;
    }
  },
  enqueue: async (items) => {
    if (items.length === 0) return [];
    if (loadingSession?.accountPubkey === items[0].accountPubkey) {
      for (const item of items) loadingSession.ids.add(item.tempId);
    }
    set((s) => ({
      items: s.account === items[0].accountPubkey ? [...s.items, ...items] : items,
      account: items[0].accountPubkey,
      loaded: s.account === items[0].accountPubkey ? s.loaded : false,
    }));
    const stagedItems = await Promise.all(
      items.map(async (item): Promise<PendingAttachment | null> => {
        try {
          const { localName, localUri } = await stagePendingAttachmentFile({
            tempId: item.tempId,
            sourceUri: item.localUri,
            mime: item.mime,
            originalName: item.name,
          });
          const current = get().items.find((candidate) => candidate.tempId === item.tempId);
          if (!current) {
            const finished = { ...item, localName, localUri };
            queuePersistence(finished, () => cleanupFinished(finished));
            return null;
          }
          const staged = { ...current, localName, localUri };
          set((s) => ({
            items: s.items.map((candidate) =>
              candidate.tempId === item.tempId ? staged : candidate,
            ),
          }));
          queuePersistence(staged, () => persistItem(staged));
          return staged;
        } catch {
          // Upload may still proceed from the picker URI, but this attempt cannot
          // survive a restart because no durable copy could be created.
          return get().items.find((candidate) => candidate.tempId === item.tempId) ?? null;
        }
      }),
    );
    return stagedItems.filter((item): item is PendingAttachment => item !== null);
  },
  removeOne: (tempId) => {
    const item = get().items.find((candidate) => candidate.tempId === tempId);
    set((s) => ({ items: s.items.filter((i) => i.tempId !== tempId) }));
    if (item && item.status !== 'sent') queuePersistence(item, () => cleanupFinished(item));
  },
  markSending: (tempId, opts) =>
    set((s) => {
      const items = s.items.map((i) =>
        i.tempId === tempId
          ? {
              ...i,
              status: 'preparing' as const,
              startedAt: opts.startedAt,
              replyToId: opts.replyToId,
              uploadedUrl: undefined,
              error: undefined,
            }
          : i,
      );
      const item = items.find((candidate) => candidate.tempId === tempId);
      if (item) queuePersistence(item, () => persistItem(item));
      return { items };
    }),
  setStatus: (tempId, status) =>
    set((s) => {
      const items = s.items.map((i) => (i.tempId === tempId ? { ...i, status } : i));
      const item = items.find((candidate) => candidate.tempId === tempId);
      if (item) queuePersistence(item, () => persistItem(item));
      return { items };
    }),
  markUploaded: (tempId, url) =>
    set((s) => ({
      items: s.items.map((item) =>
        item.tempId === tempId ? { ...item, uploadedUrl: url } : item,
      ),
    })),
  setDimensions: (tempId, dimensions) => {
    if (!validMediaDimensions(dimensions)) return;
    set((s) => {
      const index = s.items.findIndex((item) => item.tempId === tempId);
      const previous = s.items[index];
      if (!previous || (previous.width === dimensions.width && previous.height === dimensions.height)) {
        return s;
      }
      const item = { ...previous, ...dimensions };
      const items = s.items.slice();
      items[index] = item;
      queuePersistence(item, () => persistItem(item));
      return { items };
    });
  },
  markPaused: (tempId) =>
    set((s) => {
      const items = s.items.map((item) =>
        item.tempId === tempId
          ? { ...item, status: 'paused' as const, error: undefined }
          : item,
      );
      const item = items.find((candidate) => candidate.tempId === tempId);
      if (item) queuePersistence(item, () => persistItem(item));
      return { items };
    }),
  markSent: (tempId, rumorId, localFile) =>
    set((state) => {
      const previous = state.items.find((item) => item.tempId === tempId);
      if (!previous) return state;
      const visible = presentationReaders.has(presentationKey(previous.accountPubkey, previous.conversationKey));
      const sent: PendingAttachment = {
        ...previous,
        status: 'sent', sentRumorId: rumorId, error: undefined,
        localUri: localFile?.uri ?? previous.localUri,
        mime: localFile?.mime ?? previous.mime,
        localName: undefined,
      };
      queuePersistence(previous, () => cleanupFinished(previous));
      // A visible bubble can finish its handoff using the permanent mirror.
      // Unopened conversations retain neither a placeholder nor a temporary file.
      return { items: state.items.flatMap((item) => item.tempId !== tempId ? [item]
        : visible && localFile ? [sent] : []) };
    }),
  markFailed: (tempId, error) =>
    set((s) => {
      const items = s.items.map((i) =>
        i.tempId === tempId ? { ...i, status: 'failed' as const, error } : i,
      );
      const item = items.find((candidate) => candidate.tempId === tempId);
      if (item) queuePersistence(item, () => persistItem(item));
      return { items };
    }),
}));

export function newTempId(): string {
  return `tmp-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/** Presentation leases retain only in-memory handoff rows, never staging files. */
export function retainPendingAttachmentPresentation(accountPubkey: string, conversationKey: string): () => void {
  const key = presentationKey(accountPubkey, conversationKey);
  presentationReaders.set(key, (presentationReaders.get(key) ?? 0) + 1);
  return () => {
    const remaining = (presentationReaders.get(key) ?? 1) - 1;
    if (remaining > 0) { presentationReaders.set(key, remaining); return; }
    presentationReaders.delete(key);
    pendingAttachmentsStore.setState((state) => {
      const items = state.items.filter((item) => item.accountPubkey !== accountPubkey
        || item.conversationKey !== conversationKey || item.status !== 'sent');
      return items.length === state.items.length ? state : { items };
    });
  };
}
