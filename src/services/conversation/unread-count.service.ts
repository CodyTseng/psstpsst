import { and, eq, ne, sum } from 'drizzle-orm';
import { createStore } from 'zustand/vanilla';

import { db } from '@/db/client';
import { conversations } from '@/db/schema';
import { platform } from '@/platform';
import {
  isActiveConversationVisible,
  type ActiveConversation,
} from '@/services/dm/active-conversation';
import {
  getUnreadIndicatorsEnabled,
  setUnreadIndicatorsEnabled,
} from '@/services/notifications/notification-prefs';
import { syncUnreadIndicator } from '@/services/unread-indicator.service';

type UnreadCountState = {
  accountPubkey: string | null;
  count: number;
  indicatorsEnabled: boolean;
  indicatorsResolved: boolean;
};

export const unreadCountStore = createStore<UnreadCountState>()(() => ({
  accountPubkey: null,
  count: 0,
  indicatorsEnabled: true,
  indicatorsResolved: false,
}));

/** Read the same main-inbox total used by the Chats tab badge. */
export async function getMainInboxUnreadCount(
  accountPubkey: string,
  excludeConversationKey?: string,
): Promise<number> {
  const rows = await db
    .select({ total: sum(conversations.unreadCount) })
    .from(conversations)
    .where(
      and(
        eq(conversations.accountPubkey, accountPubkey),
        eq(conversations.deleted, false),
        eq(conversations.hasReplied, true),
        eq(conversations.muted, false),
        excludeConversationKey
          ? ne(conversations.conversationKey, excludeConversationKey)
          : undefined,
      ),
    );
  return Number(rows[0]?.total ?? 0);
}

/**
 * Owns the active account's unread read model. SQLite remains the source of
 * truth; transaction bursts are coalesced into one aggregate query, and every
 * UI/platform consumer observes the resulting value.
 */
class UnreadCountService {
  private configured = false;
  private accountPubkey: string | null = null;
  private generation = 0;
  private unsubscribeDatabase: (() => void) | null = null;
  private refreshScheduled = false;
  private refreshInFlight = false;
  private refreshPending = false;
  private indicatorsEnabled = true;
  private indicatorsResolved = false;
  private indicatorsLoad: Promise<boolean> | null = null;
  /** The conversation currently on screen. While the user is present it is
   * excluded from the aggregate — opening it marks it read, and incoming
   * messages for it never bump unread — so publishing the pre-read total
   * would flash a number that is about to drop. */
  private activeConversation: ActiveConversation | null = null;

  setActiveAccount(accountPubkey: string | null): void {
    this.ensureDatabaseListener();
    if (this.configured && this.accountPubkey === accountPubkey) return;

    this.configured = true;
    this.accountPubkey = accountPubkey;
    this.activeConversation = null;
    this.generation += 1;
    unreadCountStore.setState({ accountPubkey, count: 0 });
    this.scheduleRefresh();
  }

  /** Track the open conversation so its not-yet-cleared unread never leaks
   * into the published total. Set at chat mount, cleared on unmount. */
  setActiveConversation(active: ActiveConversation | null): void {
    const current = this.activeConversation;
    if (
      current?.accountPubkey === active?.accountPubkey &&
      current?.conversationKey === active?.conversationKey
    ) {
      return;
    }

    this.activeConversation = active;
    this.scheduleRefresh();
  }

  async refreshAccount(accountPubkey: string | null): Promise<void> {
    const generation = this.generation;
    const tracksActiveAccount = this.configured;
    if (tracksActiveAccount && accountPubkey !== this.accountPubkey) return;

    const [count] = await Promise.all([
      accountPubkey
        ? getMainInboxUnreadCount(accountPubkey, this.excludedConversationKey(accountPubkey))
        : Promise.resolve(0),
      this.getIndicatorsEnabled(),
    ]);
    if (
      tracksActiveAccount &&
      (generation !== this.generation || accountPubkey !== this.accountPubkey)
    ) {
      return;
    }

    if (tracksActiveAccount) {
      const current = unreadCountStore.getState();
      if (current.accountPubkey !== accountPubkey || current.count !== count) {
        unreadCountStore.setState({ accountPubkey, count });
      }
    }
    await syncUnreadIndicator(this.indicatorsEnabled ? count : 0);
  }

  async getIndicatorsEnabled(): Promise<boolean> {
    if (this.indicatorsResolved) return this.indicatorsEnabled;
    if (!this.indicatorsLoad) {
      this.indicatorsLoad = getUnreadIndicatorsEnabled().then((enabled) => {
        this.indicatorsEnabled = enabled;
        this.indicatorsResolved = true;
        unreadCountStore.setState({ indicatorsEnabled: enabled, indicatorsResolved: true });
        return enabled;
      });
    }
    return this.indicatorsLoad;
  }

  async setIndicatorsEnabled(enabled: boolean): Promise<void> {
    await this.getIndicatorsEnabled();
    await setUnreadIndicatorsEnabled(enabled);
    this.indicatorsEnabled = enabled;
    this.indicatorsResolved = true;
    unreadCountStore.setState({ indicatorsEnabled: enabled, indicatorsResolved: true });
    await syncUnreadIndicator(enabled ? unreadCountStore.getState().count : 0);
  }

  /**
   * The conversation to leave out of the aggregate right now: the open one,
   * but only while the user is actually present (the same predicate the
   * receive path uses — `shouldNotifyNow` is true exactly when the user is
   * not looking). While backgrounded its unread must still count, or the app
   * badge would miss what arrived behind the user's back.
   */
  private excludedConversationKey(accountPubkey: string): string | undefined {
    const active = this.activeConversation;
    if (!active) return undefined;

    const userPresent = !platform.notifications.shouldNotifyNow();
    return isActiveConversationVisible(
      active,
      accountPubkey,
      active.conversationKey,
      userPresent,
    )
      ? active.conversationKey
      : undefined;
  }

  private ensureDatabaseListener(): void {
    if (this.unsubscribeDatabase) return;
    this.unsubscribeDatabase = platform.database.addChangeListener((event) => {
      if (event.tableName && event.tableName !== 'conversations') return;
      this.scheduleRefresh();
    });
  }

  private scheduleRefresh(): void {
    this.refreshPending = true;
    if (this.refreshScheduled || this.refreshInFlight) return;
    this.refreshScheduled = true;
    setTimeout(() => {
      this.refreshScheduled = false;
      void this.drainRefreshes();
    }, 0);
  }

  private async drainRefreshes(): Promise<void> {
    if (this.refreshInFlight) return;
    this.refreshInFlight = true;
    try {
      while (this.refreshPending) {
        this.refreshPending = false;
        await this.refreshAccount(this.accountPubkey);
      }
    } catch (error) {
      console.warn('[unread] Failed to refresh the unread count.', error);
    } finally {
      this.refreshInFlight = false;
      if (this.refreshPending) this.scheduleRefresh();
    }
  }
}

export const unreadCountService = new UnreadCountService();

/** Refresh the database-derived count after a headless or platform operation. */
export function refreshUnreadIndicator(
  accountPubkey: string | null,
): Promise<void> {
  return unreadCountService.refreshAccount(accountPubkey);
}
