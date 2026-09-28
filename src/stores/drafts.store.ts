import { and, eq, sql } from 'drizzle-orm';
import { create } from 'zustand';

import { db } from '@/db/client';
import { conversations, messageDrafts } from '@/db/schema';
import { platform } from '@/platform';

/**
 * Unsent composer drafts, keyed by `conversationKey`, for the **active account**.
 *
 * The in-memory map is the runtime read model: the composer seeds from it and
 * writes to it on every keystroke (instant, so an inactive conversation can
 * reveal the latest draft as soon as it becomes visible), while persistence to
 * the `message_drafts` table is
 * **debounced** off the keystroke path (a database write per keystroke would add
 * avoidable IPC/native work) and flushed immediately when the
 * composer unmounts or the draft is cleared. The map holds only the loaded
 * account's drafts (`load` replaces it on account switch); `conversationKey`s are
 * account-specific, so keying by them alone never collides.
 */
const DEBOUNCE_MS = 800;
// Debounced writes: `${account}\n${key}` → the latest text owed to SQLite, plus
// its pending timer. `pending` lets us flush everything when the app backgrounds.
const pending = new Map<string, { accountPubkey: string; conversationKey: string; text: string }>();
const activityDirty = new Map<string, { accountPubkey: string; conversationKey: string }>();
const writeTimers = new Map<string, ReturnType<typeof setTimeout>>();

function clearTimer(id: string): void {
  const t = writeTimers.get(id);
  if (t) {
    clearTimeout(t);
    writeTimers.delete(id);
  }
}

function flushPending(id: string, advanceActivity = false): void {
  clearTimer(id);
  const p = pending.get(id);
  const dirty = activityDirty.get(id);
  if (!p && (!advanceActivity || !dirty)) return;
  if (p) pending.delete(id);
  if (advanceActivity) activityDirty.delete(id);
  const owner = p ?? dirty!;
  void persist(owner.accountPubkey, owner.conversationKey, p?.text, advanceActivity);
}

// Persist any debounced drafts the instant the app leaves the foreground — a
// mobile OS can kill a backgrounded app without notice, which would otherwise
// drop a draft still inside its debounce window.
platform.appState.addChangeListener((state) => {
  if (state !== 'active') {
    for (const id of new Set([...pending.keys(), ...activityDirty.keys()])) {
      flushPending(id, true);
    }
  }
});

// Must `await` the drizzle ops: the query builder is lazy and only runs when
// awaited (or `.run()`/`.then()`) — a bare `void db.insert(...)` never executes,
// so the write would silently no-op. Errors are swallowed (best-effort; the
// in-memory store is this session's source of truth).
async function persist(
  accountPubkey: string,
  conversationKey: string,
  text: string | undefined,
  advanceActivity: boolean,
): Promise<void> {
  try {
    // Empty draft → no row (a present row always means "there's a draft").
    if (text !== undefined && text.trim().length === 0) {
      await db
        .delete(messageDrafts)
        .where(
          and(
            eq(messageDrafts.accountPubkey, accountPubkey),
            eq(messageDrafts.conversationKey, conversationKey),
          ),
        );
    } else if (text !== undefined) {
      const updatedAt = Math.floor(Date.now() / 1000);
      await db
        .insert(messageDrafts)
        .values({ accountPubkey, conversationKey, text, updatedAt })
        .onConflictDoUpdate({
          target: [messageDrafts.accountPubkey, messageDrafts.conversationKey],
          set: { text, updatedAt },
        });
    }
    if (advanceActivity) {
      const activityOrderAt = Date.now();
      await db
        .update(conversations)
        .set({
          updatedAt: sql`CASE WHEN ${conversations.updatedOrderAt} < ${activityOrderAt} THEN ${Math.floor(activityOrderAt / 1000)} ELSE ${conversations.updatedAt} END`,
          updatedOrderAt: sql`MAX(${conversations.updatedOrderAt}, ${activityOrderAt})`,
        })
        .where(
          and(
            eq(conversations.accountPubkey, accountPubkey),
            eq(conversations.conversationKey, conversationKey),
          ),
        );
    }
  } catch {
    // Best-effort persistence.
  }
}

function scheduleWrite(accountPubkey: string, conversationKey: string, text: string): void {
  const id = `${accountPubkey}\n${conversationKey}`;
  pending.set(id, { accountPubkey, conversationKey, text });
  activityDirty.set(id, { accountPubkey, conversationKey });
  clearTimer(id);
  writeTimers.set(id, setTimeout(() => flushPending(id, false), DEBOUNCE_MS));
}

function flushWrite(accountPubkey: string, conversationKey: string, text: string): void {
  const id = `${accountPubkey}\n${conversationKey}`;
  pending.set(id, { accountPubkey, conversationKey, text });
  flushPending(id, false);
}

type State = {
  /** Drafts for `account`, keyed by conversationKey. Trimmed-empty entries are
   * removed, so a present, non-empty value means "this chat has a draft". */
  drafts: Record<string, string>;
  /** The account `drafts` currently holds — guards reloads / cross-account use. */
  account: string | null;
  load: (accountPubkey: string) => Promise<void>;
  setDraft: (conversationKey: string, text: string) => void;
  clearDraft: (conversationKey: string) => void;
  /** Persist a conversation's current draft now (e.g. composer unmount), bypassing
   * the debounce so navigating away can't drop the last keystrokes. */
  flush: (conversationKey: string) => void;
};

export const useDraftsStore = create<State>((set, get) => ({
  drafts: {},
  account: null,
  load: async (accountPubkey) => {
    if (get().account === accountPubkey) return; // already holding this account
    const rows = await db
      .select({ conversationKey: messageDrafts.conversationKey, text: messageDrafts.text })
      .from(messageDrafts)
      .where(eq(messageDrafts.accountPubkey, accountPubkey));
    const map: Record<string, string> = {};
    for (const r of rows) map[r.conversationKey] = r.text;
    set({ drafts: map, account: accountPubkey });
  },
  setDraft: (conversationKey, text) => {
    const account = get().account;
    if (!account) return;
    const empty = text.trim().length === 0;
    set((s) => {
      // Avoid a new object (and subscriber churn) when nothing actually changes.
      const current = s.drafts[conversationKey];
      if (empty ? current === undefined : current === text) return s;
      const drafts = { ...s.drafts };
      if (empty) delete drafts[conversationKey];
      else drafts[conversationKey] = text;
      return { drafts };
    });
    scheduleWrite(account, conversationKey, text);
  },
  clearDraft: (conversationKey) => {
    const account = get().account;
    set((s) => {
      if (s.drafts[conversationKey] === undefined) return s;
      const drafts = { ...s.drafts };
      delete drafts[conversationKey];
      return { drafts };
    });
    if (account) flushWrite(account, conversationKey, '');
  },
  flush: (conversationKey) => {
    const account = get().account;
    if (!account) return;
    // Keystrokes already enqueue the latest value. If its debounce completed,
    // there is nothing left to persist; avoid an unconditional write on every
    // chat unmount, including untouched empty composers.
    flushPending(`${account}\n${conversationKey}`, true);
  },
}));
