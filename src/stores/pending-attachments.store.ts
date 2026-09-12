import { and, eq } from 'drizzle-orm';
import { create } from 'zustand';
import { useShallow } from 'zustand/react/shallow';

import { db } from '@/db/client';
import { pendingAttachments } from '@/db/schema';
import {
  deletePendingAttachmentFile,
  pendingAttachmentFileExists,
  pendingAttachmentUri,
  stagePendingAttachmentFile,
} from '@/services/files/pending-attachment-file.service';
import type { ImageSendQuality } from '@/lib/attachments/image-quality';

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
 * bubble until the real (live-query) bubble for `sentRumorId` is on screen,
 * then drop it in the same render — no empty gap, no double image.
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

type State = {
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
  markSent: (tempId: string, rumorId: string) => void;
  markFailed: (tempId: string, error: string) => void;
};

export const PENDING_UPLOAD_INTERRUPTED = 'UPLOAD_INTERRUPTED';
let loadGeneration = 0;
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
  if (!item.localName || item.status === 'sent') return;
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

async function deletePersisted(item: PendingAttachment): Promise<void> {
  await db
    .delete(pendingAttachments)
    .where(
      and(
        eq(pendingAttachments.accountPubkey, item.accountPubkey),
        eq(pendingAttachments.tempId, item.tempId),
      ),
    )
    .catch(() => {});
  await deletePendingAttachmentFile(item.localName);
}

async function deletePersistedRow(item: PendingAttachment): Promise<void> {
  await db
    .delete(pendingAttachments)
    .where(
      and(
        eq(pendingAttachments.accountPubkey, item.accountPubkey),
        eq(pendingAttachments.tempId, item.tempId),
      ),
    )
    .catch(() => {});
}

export const usePendingAttachmentsStore = create<State>((set, get) => ({
  items: [],
  account: null,
  loaded: false,
  load: async (accountPubkey) => {
    if (get().account === accountPubkey && get().loaded) return;
    const generation = ++loadGeneration;
    const rows = await db
      .select()
      .from(pendingAttachments)
      .where(eq(pendingAttachments.accountPubkey, accountPubkey));
    const restored: PendingAttachment[] = [];
    for (const row of rows) {
      if (!(await pendingAttachmentFileExists(row.localName))) {
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
  },
  enqueue: async (items) => {
    if (items.length === 0) return [];
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
            void deletePendingAttachmentFile(localName);
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
    if (item) queuePersistence(item, () => deletePersisted(item));
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
  markSent: (tempId, rumorId) =>
    set((s) => {
      const previous = s.items.find((candidate) => candidate.tempId === tempId);
      const items = s.items.map((i) =>
        i.tempId === tempId
          ? { ...i, status: 'sent' as const, sentRumorId: rumorId, error: undefined }
          : i,
      );
      // Keep the staged file until the real DB bubble replaces this placeholder;
      // removeOne performs the final file cleanup during that handoff.
      if (previous) queuePersistence(previous, () => deletePersistedRow(previous));
      return { items };
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

export function useInFlightAttachmentsFor(
  accountPubkey: string,
  conversationKey: string,
): PendingAttachment[] {
  return usePendingAttachmentsStore(
    useShallow((s) =>
      s.items.filter(
        (i) =>
          i.accountPubkey === accountPubkey && i.conversationKey === conversationKey,
      ),
    ),
  );
}

export function newTempId(): string {
  return `tmp-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}
