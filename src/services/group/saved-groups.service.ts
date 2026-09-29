import { and, eq, inArray } from 'drizzle-orm';
import type { Event } from 'nostr-tools';

import { db } from '@/db/client';
import { conversations, savedGroups } from '@/db/schema';
import { isValidGroupId } from '@/lib/nostr/group-messaging';

import { buildSigner } from '../account/account.service';
import {
  canApplyConfigurationEvent,
  prepareConfiguration,
  publishConfiguration,
} from '../relay/configuration-publish.service';
import type { Signer } from '../signer/signer.interface';

export const KIND_APP_DATA = 30078;
export const SAVED_GROUPS_D = 'psstpsst-saved-groups';

type SavedGroupsPayload = {
  version: 1;
  groups: string[];
};

async function getSavedGroupIds(accountPubkey: string): Promise<string[]> {
  const rows = await db
    .select({ groupId: savedGroups.groupId })
    .from(savedGroups)
    .where(eq(savedGroups.accountPubkey, accountPubkey));
  return rows.map(({ groupId }) => groupId).sort();
}

async function publishSavedGroups(accountPubkey: string, signer: Signer): Promise<void> {
  if (!signer.nip44Encrypt) return;
  const payload: SavedGroupsPayload = {
    version: 1,
    groups: await getSavedGroupIds(accountPubkey),
  };
  const content = await signer.nip44Encrypt(accountPubkey, JSON.stringify(payload));
  await publishConfiguration(accountPubkey, signer, {
    kind: KIND_APP_DATA,
    content,
    tags: [['d', SAVED_GROUPS_D]],
    created_at: Math.floor(Date.now() / 1000),
  });
}

function persistSavedGroups(accountPubkey: string, signer?: Signer): Promise<void> {
  return prepareConfiguration(accountPubkey, KIND_APP_DATA, SAVED_GROUPS_D, async () => {
    const resolvedSigner = signer ?? (await buildSigner(accountPubkey));
    await publishSavedGroups(accountPubkey, resolvedSigner);
  });
}

export async function setGroupSaved(
  accountPubkey: string,
  groupId: string,
  saved: boolean,
  options: { signer?: Signer } = {},
): Promise<void> {
  if (!isValidGroupId(groupId)) throw new Error('Invalid group id');
  if (saved) {
    await db.transaction(async (tx) => {
      await tx
        .insert(savedGroups)
        .values({ accountPubkey, groupId })
        .onConflictDoNothing()
        .run();
      await tx
        .update(conversations)
        .set({
          deleted: false,
          deletedAt: null,
          deletedOrderAt: null,
          hasReplied: true,
        })
        .where(
          and(
            eq(conversations.accountPubkey, accountPubkey),
            eq(conversations.groupId, groupId),
          ),
        )
        .run();
    });
  } else {
    await db
      .delete(savedGroups)
      .where(
        and(
          eq(savedGroups.accountPubkey, accountPubkey),
          eq(savedGroups.groupId, groupId),
        ),
      );
  }
  await persistSavedGroups(accountPubkey, options.signer);
}

function parseSavedGroupsPayload(value: unknown): string[] | null {
  if (!value || typeof value !== 'object') return null;
  const payload = value as Partial<SavedGroupsPayload>;
  if (payload.version !== 1 || !Array.isArray(payload.groups)) return null;
  if (payload.groups.some((groupId) => !isValidGroupId(groupId))) return null;
  return [...new Set(payload.groups)].sort();
}

export async function applySavedGroupsEvent(
  accountPubkey: string,
  event: Event | null,
  signer: Signer,
): Promise<void> {
  if (!event || !signer.nip44Decrypt) return;
  if (
    !(await canApplyConfigurationEvent(
      accountPubkey,
      KIND_APP_DATA,
      SAVED_GROUPS_D,
      event,
    ))
  ) return;

  let groupIds: string[] | null;
  try {
    const plaintext = await signer.nip44Decrypt(accountPubkey, event.content);
    groupIds = parseSavedGroupsPayload(JSON.parse(plaintext));
  } catch {
    return;
  }
  if (!groupIds) return;

  await db.transaction(async (tx) => {
    if (
      !(await canApplyConfigurationEvent(
        accountPubkey,
        KIND_APP_DATA,
        SAVED_GROUPS_D,
        event,
        tx,
      ))
    ) return;
    await tx.delete(savedGroups).where(eq(savedGroups.accountPubkey, accountPubkey)).run();
    if (groupIds.length > 0) {
      await tx
        .insert(savedGroups)
        .values(groupIds.map((groupId) => ({ accountPubkey, groupId })))
        .onConflictDoNothing()
        .run();
      await tx
        .update(conversations)
        .set({
          deleted: false,
          deletedAt: null,
          deletedOrderAt: null,
          hasReplied: true,
        })
        .where(
          and(
            eq(conversations.accountPubkey, accountPubkey),
            inArray(conversations.groupId, groupIds),
          ),
        )
        .run();
    }
  });
}
