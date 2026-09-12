import { and, eq, inArray, ne, or } from 'drizzle-orm';

import { db } from '@/db/client';
import { attachmentUrls, conversations, messageMedia, storedFiles } from '@/db/schema';

/** A downloaded blob's content-addressed on-disk identity. */
export type BlobRef = { ox: string; mime: string };

/**
 * Resolve a kind-15 attachment to a file that is currently present locally.
 * Prefer the signed plaintext hash; messages without `ox` fall back through the
 * protocol URL mapping populated after the first verified download.
 */
export async function resolveDownloaded(meta: {
  url: string;
  plainSha256Hex?: string;
}): Promise<BlobRef | null> {
  if (meta.plainSha256Hex) {
    const rows = await db
      .select({ ox: storedFiles.ox, mime: storedFiles.mime })
      .from(storedFiles)
      .where(eq(storedFiles.ox, meta.plainSha256Hex))
      .limit(1);
    return rows[0] ?? null;
  }

  const rows = await db
    .select({ ox: storedFiles.ox, mime: storedFiles.mime })
    .from(attachmentUrls)
    .innerJoin(storedFiles, eq(storedFiles.ox, attachmentUrls.ox))
    .where(eq(attachmentUrls.url, meta.url))
    .limit(1);
  return rows[0] ?? null;
}

/** Record a verified URL mapping and the file that is now present on disk. */
export async function markDownloaded(
  url: string,
  ox: string,
  mime: string,
  size?: number,
): Promise<void> {
  await markDownloadedBatch([url], ox, mime, size);
}

/** Restore one verified content-addressed file and a bounded batch of remote
 * URL mappings from an archive. The caller chunks large URL sets so SQLite's
 * bind-variable limit and JS memory stay bounded. */
export async function markDownloadedBatch(
  urls: string[],
  ox: string,
  mime: string,
  size?: number,
): Promise<void> {
  await db.transaction(async (tx) => {
    if (urls.length > 0) {
      await tx
        .insert(attachmentUrls)
        .values(urls.map((url) => ({ url, ox })))
        .onConflictDoUpdate({ target: attachmentUrls.url, set: { ox } })
        .run();
    }
    await tx
      .insert(storedFiles)
      .values({
        ox,
        mime,
        size: size ?? null,
        downloadedAt: Math.floor(Date.now() / 1000),
      })
      .onConflictDoUpdate({
        target: storedFiles.ox,
        set: {
          mime,
          ...(size != null ? { size } : {}),
          downloadedAt: Math.floor(Date.now() / 1000),
        },
      })
      .run();
  });
}

/** Register archive-restored state without changing any mapping or file record
 * already established by normal downloads or an earlier import. */
export async function markImportedBatch(
  urls: string[],
  ox: string,
  mime: string,
  size?: number,
): Promise<void> {
  const downloadedAt = Math.floor(Date.now() / 1000);
  await db.transaction(async (tx) => {
    if (urls.length > 0) {
      await tx
        .insert(attachmentUrls)
        .values(urls.map((url) => ({ url, ox })))
        .onConflictDoNothing()
        .run();
    }
    await tx
      .insert(storedFiles)
      .values({
        ox,
        mime,
        size: size ?? null,
        downloadedAt,
      })
      .onConflictDoNothing()
      .run();
  });
}

/**
 * Downloaded files referenced by one conversation and no other live
 * conversation. URL identity, local state, and message references are joined
 * only for this bounded cleanup operation.
 */
export async function listOrphanBlobsForConversation(
  accountPubkey: string,
  conversationKey: string,
): Promise<BlobRef[]> {
  const mine = await db
    .selectDistinct({ ox: storedFiles.ox, mime: storedFiles.mime })
    .from(messageMedia)
    .innerJoin(attachmentUrls, eq(attachmentUrls.url, messageMedia.url))
    .innerJoin(storedFiles, eq(storedFiles.ox, attachmentUrls.ox))
    .where(
      and(
        eq(messageMedia.accountPubkey, accountPubkey),
        eq(messageMedia.conversationKey, conversationKey),
        eq(messageMedia.source, 'attachment'),
      ),
    );
  const oxes = mine.map((row) => row.ox);
  if (oxes.length === 0) return [];

  const stillUsed = await db
    .selectDistinct({ ox: attachmentUrls.ox })
    .from(messageMedia)
    .innerJoin(attachmentUrls, eq(attachmentUrls.url, messageMedia.url))
    .innerJoin(
      conversations,
      and(
        eq(conversations.accountPubkey, messageMedia.accountPubkey),
        eq(conversations.conversationKey, messageMedia.conversationKey),
      ),
    )
    .where(
      and(
        inArray(attachmentUrls.ox, oxes),
        eq(messageMedia.source, 'attachment'),
        or(
          ne(messageMedia.accountPubkey, accountPubkey),
          ne(messageMedia.conversationKey, conversationKey),
        ),
        eq(conversations.deleted, false),
      ),
    );
  const used = new Set(stillUsed.map((row) => row.ox));
  return mine.filter((row) => !used.has(row.ox));
}

/** Downloaded files owned only by the account being removed. */
export async function listOrphanBlobsForAccount(accountPubkey: string): Promise<BlobRef[]> {
  const mine = await db
    .selectDistinct({ ox: storedFiles.ox, mime: storedFiles.mime })
    .from(messageMedia)
    .innerJoin(attachmentUrls, eq(attachmentUrls.url, messageMedia.url))
    .innerJoin(storedFiles, eq(storedFiles.ox, attachmentUrls.ox))
    .where(
      and(
        eq(messageMedia.accountPubkey, accountPubkey),
        eq(messageMedia.source, 'attachment'),
      ),
    );
  const oxes = mine.map((row) => row.ox);
  if (oxes.length === 0) return [];

  const stillUsed = await db
    .selectDistinct({ ox: attachmentUrls.ox })
    .from(messageMedia)
    .innerJoin(attachmentUrls, eq(attachmentUrls.url, messageMedia.url))
    .innerJoin(
      conversations,
      and(
        eq(conversations.accountPubkey, messageMedia.accountPubkey),
        eq(conversations.conversationKey, messageMedia.conversationKey),
      ),
    )
    .where(
      and(
        inArray(attachmentUrls.ox, oxes),
        eq(messageMedia.source, 'attachment'),
        ne(messageMedia.accountPubkey, accountPubkey),
        eq(conversations.deleted, false),
      ),
    );
  const used = new Set(stillUsed.map((row) => row.ox));
  return mine.filter((row) => !used.has(row.ox));
}

/** Attachment URLs to evict from the short-lived in-memory URI cache. */
export async function listConversationUrls(
  accountPubkey: string,
  conversationKey: string,
): Promise<string[]> {
  const rows = await db
    .selectDistinct({ url: messageMedia.url })
    .from(messageMedia)
    .innerJoin(attachmentUrls, eq(attachmentUrls.url, messageMedia.url))
    .where(
      and(
        eq(messageMedia.accountPubkey, accountPubkey),
        eq(messageMedia.conversationKey, conversationKey),
        eq(messageMedia.source, 'attachment'),
      ),
    );
  return rows.map((row) => row.url);
}

/** Remove local-state rows after their physical files have been freed. */
export async function removeStoredFilesByOx(oxes: string[]): Promise<void> {
  if (oxes.length === 0) return;
  await db.delete(storedFiles).where(inArray(storedFiles.ox, oxes));
}
