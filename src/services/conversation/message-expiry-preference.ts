import { and, eq } from 'drizzle-orm';
import { db } from '@/db/client';
import { conversations, privateListSyncState } from '@/db/schema';
import {
  MESSAGE_EXPIRY_SETTINGS_D, MESSAGE_EXPIRY_SETTINGS_KIND, messageExpirationTag, validExpiryDuration,
} from '@/lib/nostr/disappearing-message';

export const DEFAULT_MESSAGE_EXPIRY_SLOT = '';
export const validExpiryConversationKey = /^[0-9a-f]{64}$/;
const legacyGroupExpiryKey = /^group:[0-9a-f]{64}$/;

export type MessageExpiryValues = Map<string, number>;

export function decodeMessageExpirySettings(tags: unknown): MessageExpiryValues | null {
  if (!Array.isArray(tags) || JSON.stringify(tags[0]) !== '["v","1"]') return null;
  const result: MessageExpiryValues = new Map();
  for (const tag of tags.slice(1)) {
    if (!Array.isArray(tag)) return null;
    // Ignore obsolete group overrides without discarding the rest of the document.
    if (tag[0] === 'conversation' && tag.length === 3 &&
        typeof tag[1] === 'string' && legacyGroupExpiryKey.test(tag[1])) continue;
    const key = tag[0] === 'default' && tag.length === 2 ? DEFAULT_MESSAGE_EXPIRY_SLOT :
      tag[0] === 'conversation' && tag.length === 3 && typeof tag[1] === 'string' && validExpiryConversationKey.test(tag[1]) ? tag[1] : null;
    const raw = tag.at(-1);
    if (key === null || result.has(key) || typeof raw !== 'string' || !/^\d+$/.test(raw) || !validExpiryDuration(Number(raw))) return null;
    result.set(key, Number(raw));
  }
  return result.has(DEFAULT_MESSAGE_EXPIRY_SLOT) ? result : null;
}

export function messageExpirySettingsQuery(accountPubkey: string) {
  return db.select().from(privateListSyncState).where(and(
    eq(privateListSyncState.accountPubkey, accountPubkey),
    eq(privateListSyncState.kind, MESSAGE_EXPIRY_SETTINGS_KIND),
    eq(privateListSyncState.dTag, MESSAGE_EXPIRY_SETTINGS_D),
  )).limit(1);
}

export function readExpirySettings(state: Pick<typeof privateListSyncState.$inferSelect, 'draft' | 'snapshot'> | undefined) {
  return decodeMessageExpirySettings(state?.draft ?? state?.snapshot?.tags);
}

export function messageExpiryDuration(values: MessageExpiryValues | null, key: string, legacy?: number | null): number | null {
  return values ? values.get(key) ?? null : legacy ?? null;
}

export async function authoredExpirationTags(account: string, key: string, createdAt: number): Promise<string[][]> {
  if (!validExpiryConversationKey.test(key)) return [];
  const state = (await messageExpirySettingsQuery(account))[0];
  const values = readExpirySettings(state);
  const legacy = values ? null : await db.select({ duration: conversations.disappearAfterSeconds }).from(conversations)
    .where(and(eq(conversations.accountPubkey, account), eq(conversations.conversationKey, key))).get();
  const seconds = values?.get(key) ?? values?.get(DEFAULT_MESSAGE_EXPIRY_SLOT) ?? legacy?.duration ?? 0;
  return seconds > 0 && validExpiryDuration(seconds) ? [messageExpirationTag(createdAt, seconds)] : [];
}
