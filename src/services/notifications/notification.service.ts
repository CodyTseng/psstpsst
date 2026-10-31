import type { Rumor } from '@/db/schema/types';
import i18n from '@/i18n';
import { scheduleBackgroundDeadline } from '@/lib/background-deadline';
import { IS_DEVELOPMENT_BUILD } from '@/lib/environment';
import { platform } from '@/platform';
import { getActiveAccountPubkey } from '@/services/account/account.service';
import { getMainInboxUnreadCount, unreadCountService } from '@/services/conversation/unread-count.service';
import { invalidateAllWarmedMessageTails } from '@/services/conversation/message-tail-cache';
import { observedPeerKeyService } from '@/services/dm/observed-peer-key.service';
import { dmService } from '@/services/dm/dm.service';
import { receiveSessionStore } from '@/services/dm/receive-session';
import { retryUnreadIndicator } from '@/services/unread-indicator.service';
import { isMessageOrderNewer, messageOrderAt } from '@/lib/nostr/message-order';

import { registerBackgroundPoll, unregisterBackgroundPoll } from './background-task';
import { evaluateNotificationRumors, buildNotificationContent } from './notification-policy';
import { pushRegistrationService } from './push-registration.service';
import {
  DEFAULT_NOTIFICATION_CONTENT_PREFERENCES,
  getBatteryOptimizationPrompted,
  getDndWindow,
  getNotificationContentPreferences,
  getNotificationsEnabled,
  getUnreadIndicatorsEnabled,
  isDndActiveNow,
  setBatteryOptimizationPrompted,
  setDndWindow,
  setNotificationContentPreferences,
  setNotificationsEnabled,
  type DndWindow,
  type NotificationContentPreferences,
} from './notification-prefs';

/** One fixed window coalesces a burst without indefinitely delaying a busy stream. */
export const NOTIFICATION_AGGREGATION_WINDOW_MS = 1_000;

export type NotificationStatus = {
  /** The notification preference the user toggled in Settings. */
  enabled: boolean;
  /** Whether the OS has granted notification permission. */
  granted: boolean;
};

type ScheduledFlush = {
  cancelTimer(): void;
  flushing: boolean;
  promise: Promise<void>;
  resolve(): void;
  reject(error: unknown): void;
};

type NotifyOptions = {
  /** Cold polls do not establish a live DM session. */
  accountPubkey?: string;
  /** A bounded background-task batch is already complete; deliver it without
   * waiting on an RN timer that may not receive Choreographer frames. */
  flushImmediately?: boolean;
};

/**
 * Local-notification manager. Multiple messages coalesce into one notification.
 * Sender identity and message content are independently opt-in and default off;
 * the generic count remains the fallback presentation.
 *
 * Every newly-stored rumor flows through ONE funnel (`notifyNewRumors`),
 * regardless of producer:
 *
 * - **Live path:** the `onNewMessage` hook — the decrypt-and-store path only,
 *   never the backup importer — fires while the app is backgrounded but the JS
 *   runtime is still alive.
 * - **Background poll:** `background-task.ts` wakes periodically (WorkManager on
 *   Android, main-process timer on desktop; disabled on iOS), runs `dmService.pollForNotifications`,
 *   and hands the freshly-stored rumors here.
 *
 * The funnel dedups by rumor id, so a rumor that arrives twice (live listener
 * AND a poll in the same JS session) counts once; on Android headless the
 * listener never ran, so the poll's funnel call is the only counter. Whether
 * "now" is a good time to notify is the port's call (`shouldNotifyNow`):
 * mobile gates on the app being strictly backgrounded, desktop on the window
 * being hidden or unfocused.
 *
 * All OS interaction goes through the `notifications` platform port, which
 * tolerates the capability being absent (Expo Go / pre-rebuild dev client).
 */
class NotificationService {
  private initialized = false;
  private enabled = false;
  private contentPreferences = DEFAULT_NOTIFICATION_CONTENT_PREFERENCES;
  private contentPreferencesLoaded = false;
  private contentPreferencesLoading: Promise<void> | null = null;
  private dndWindow: DndWindow | null = null;
  private dndLoading: Promise<DndWindow> | null = null;
  private cachedStatus: NotificationStatus | null = null;
  private statusRevision = 0;
  private settingsWrites = new Set<Promise<void>>();
  /** Whether the native handler/channel/tap-listener have been wired. Done lazily
   * once notification permission is granted (no error if the module is absent). */
  private nativeWired = false;
  /** Serializes native foreground-service start/stop transitions independently
   * from notification aggregation. */
  private backgroundMessagingQueue: Promise<void> = Promise.resolve();
  /** Qualifying messages seen since the user last returned to the app. */
  private pendingCount = 0;
  /** The newest qualifying message in the current aggregate. Keeping one rumor
   * bounds preview memory even during a very large background burst. */
  private latestPendingRumor: Rumor | null = null;
  /** Ids of rumors already evaluated in this away stint — the dedup that keeps
   * the live and poll producers from filtering or counting one message twice.
   * Cleared together with the count when the user returns, so it stays
   * bounded by one background stint's worth of messages. */
  private processedIds = new Set<string>();
  /** A fixed-window flush timer. New messages join the existing window rather
   * than resetting it, so a continuous stream can never postpone delivery. */
  private scheduledFlush: ScheduledFlush | null = null;
  /** Serializes count updates, dismiss/present, and the user-returned reset so
   * near-simultaneous messages can't interleave or race the reset. */
  private queue: Promise<void> = Promise.resolve();
  private notificationEpoch = 0;

  async init(): Promise<void> {
    if (this.initialized) return;
    this.initialized = true;
    platform.database?.addChangeListener((event) => {
      if (!event.external) return;
      if (!event.tableName || event.tableName === 'device_preferences') {
        this.contentPreferencesLoaded = false;
        this.dndWindow = null;
      }
      invalidateAllWarmedMessageTails();
      observedPeerKeyService.invalidateCache();
    });
    receiveSessionStore.subscribe((next, previous) => {
      if (next.status === previous.status && next.accountPubkey === previous.accountPubkey) return;
      if (next.status !== 'ready') this.clearPendingState();
      void this.syncBackgroundMessaging().catch((error) => {
        console.warn('[notifications] Failed to update background receiving.', error);
      });
    });

    // Warm settings independently so a failed optional read cannot stop notification delivery.
    void this.getDndWindow().catch(error => console.warn('[notifications] Unable to warm quiet-hours settings.', error));
    const [enabled] = await Promise.all([
      getNotificationsEnabled(),
      this.getContentPreferences(),
    ]);
    this.enabled = enabled;
    pushRegistrationService.setEnabled(enabled);
    platform.notifications.addUserReturnedListener(() => {
      this.resetPending();
      void pushRegistrationService.reconcile();
    });
    platform.pushNotifications?.addTokenChangedListener(() => {
      void pushRegistrationService.reconcile();
    });
    if (platform.pushNotifications?.isAvailable()) {
      platform.networkState.addStateListener((state) => {
        if (state.isConnected === true) void pushRegistrationService.reconcile();
      });
      receiveSessionStore.subscribe(() => { void pushRegistrationService.reconcile(); });
    }

    // Always listen for live messages (cheap; the funnel guards on `enabled`).
    dmService.addListener({
      onNewMessage: (rumor) => {
        void this.notifyNewRumors([rumor]).catch((error) => {
          console.warn('[notifications] Failed to process a live message.', error);
        });
      },
    });
    if (this.enabled) {
      if (!platform.notifications.isAvailable()) {
        this.cachedStatus = { enabled: false, granted: false };
        await this.syncBackgroundMessaging();
        return;
      }
      const granted = await platform.notifications.ensurePermission(
        i18n.t('notifications.channel_name'),
      );
      this.cachedStatus = { enabled: this.enabled, granted };
      if (!granted) {
        await this.handlePermissionLoss();
        return;
      }
      await this.requestBatteryOptimizationExemptionOnce();
      this.wireNative();
      await retryUnreadIndicator();
    }
    await this.syncBackgroundMessaging();
    void pushRegistrationService.reconcile();
  }

  /** Native residency and periodic recovery share the receive-readiness gate.
   * A login pointer or notification preference alone cannot resume a stale key. */
  private syncBackgroundMessaging(): Promise<void> {
    const canRun = () => this.enabled && this.nativeWired &&
      receiveSessionStore.getState().status === 'ready';
    const stop = () => Promise.all([
      platform.backgroundMessaging.stop(),
      unregisterBackgroundPoll(),
    ]);
    const run = this.backgroundMessagingQueue.then(async () => {
      if (!canRun()) {
        await stop();
        return;
      }
      await registerBackgroundPoll();
      // Key invalidation can arrive while the OS registers the periodic task.
      if (!canRun()) {
        await stop();
        return;
      }
      if (platform.backgroundMessaging.isAvailable()) {
        await platform.backgroundMessaging.start({
          channelName: i18n.t('notifications.channel_name'),
          message: i18n.t('notifications.background_service_message'),
        });
      }
    });
    this.backgroundMessagingQueue = run.catch(() => {});
    return run;
  }

  /** Android's relay transport cannot use FCM, so Doze can break timely message
   * delivery. Ask once, only after notification permission is available; a
   * denial stays respected and the Notifications screen retains manual guidance. */
  private async requestBatteryOptimizationExemptionOnce(): Promise<void> {
    if (!platform.backgroundMessaging.isAvailable()) return;
    try {
      if (await getBatteryOptimizationPrompted()) return;
      if (await platform.backgroundMessaging.isBatteryOptimizationExempt()) {
        await setBatteryOptimizationPrompted();
        return;
      }
      const opened = await platform.backgroundMessaging.requestBatteryOptimizationExemption();
      if (opened) await setBatteryOptimizationPrompted();
    } catch (error) {
      // This optional reliability prompt must never prevent notification setup.
      console.warn('[notifications] Unable to request a battery-optimization exemption.', error);
    }
  }

  /** Set up the notification handler and tap behavior — once,
   * and only when notifications are on. */
  private wireNative(): void {
    if (this.nativeWired) return;
    if (!platform.notifications.isAvailable()) return;
    this.nativeWired = true;
    platform.notifications.setDefaultHandler();
    // No tap handler: tapping just opens the app (cold → the chats list, warm →
    // wherever it was), and the user's return already dismisses the standing
    // notification. Navigating from here risks touching the router before it's
    // mounted on a cold launch from a tap.
  }

  /**
   * The single counting funnel. Feed it freshly-stored rumors — from the live
   * `onNewMessage` hook or the background poll — and it dedups, filters
   * (self / reaction / group / muted / message-request rules), then adds them
   * to one short aggregation window. Called on a cold background-task launch
   * too, where `init` never ran: the preference is then read from storage
   * instead of the in-memory flag.
   */
  async notifyNewRumors(rumors: Rumor[], options: NotifyOptions = {}): Promise<void> {
    const epoch = this.notificationEpoch;
    if (rumors.length === 0) return;
    if (!(await this.isEnabled())) return;
    // Quiet hours: messages arriving inside the window are stored and counted
    // as unread, but never notify — nothing is queued for later delivery.
    if (await isDndActiveNow()) return;
    if (!platform.notifications.shouldNotifyNow()) return;

    const accountPubkey = options.accountPubkey ?? dmService.getAccountPubkey();
    if (!accountPubkey) return;
    if (this.isReceiveBlocked(accountPubkey)) return;

    let flushPromise: Promise<void> | null = null;
    await this.enqueue(async () => {
      if (epoch !== this.notificationEpoch) return;
      const unseen = rumors.filter((rumor) => !this.processedIds.has(rumor.id));
      const qualifying = await evaluateNotificationRumors(unseen, accountPubkey, !platform.notifications.shouldNotifyNow());
      if (epoch !== this.notificationEpoch || this.isReceiveBlocked(accountPubkey)) return;
      for (const rumor of unseen) this.processedIds.add(rumor.id);
      if (qualifying.length === 0) return;

      // Settings or presence can change while filtering waits on SQLite.
      if (epoch !== this.notificationEpoch || !this.enabled || !platform.notifications.shouldNotifyNow()) return;

      this.pendingCount += qualifying.length;
      for (const rumor of qualifying) {
        if (!this.latestPendingRumor || this.isNewer(rumor, this.latestPendingRumor)) {
          this.latestPendingRumor = rumor;
        }
      }
      flushPromise = this.scheduleFlush();
    });
    if (options.flushImmediately) {
      const scheduled = this.scheduledFlush;
      if (scheduled && !scheduled.flushing) {
        scheduled.cancelTimer();
        this.runScheduledFlush(scheduled);
      }
    }
    // Background-task callers await this method, keeping their execution window
    // alive until the aggregate reaches the OS. Live listeners intentionally
    // fire-and-forget the same promise.
    if (flushPromise) await flushPromise;
  }

  private async isEnabled(): Promise<boolean> {
    // A cold background-task launch never runs `init`; read the preference
    // from storage so the poll path works headless too.
    if (!this.initialized) this.enabled = await getNotificationsEnabled();
    return this.enabled;
  }

  private isReceiveBlocked(accountPubkey: string | null): boolean {
    const session = receiveSessionStore.getState();
    return (session.status === 'key-required' && session.accountPubkey === accountPubkey) ||
      (session.status === 'ready' && session.accountPubkey !== accountPubkey);
  }

  private isNewer(candidate: Rumor, current: Rumor): boolean {
    const candidateOrder = messageOrderAt(candidate);
    const currentOrder = messageOrderAt(current);
    return isMessageOrderNewer(
      { orderAt: candidateOrder, id: candidate.id },
      { orderAt: currentOrder, id: current.id },
    );
  }

  private async ensureContentPreferencesLoaded(): Promise<void> {
    if (this.contentPreferencesLoaded) return;
    if (!this.contentPreferencesLoading) {
      this.contentPreferencesLoading = getNotificationContentPreferences().then(preferences => {
        if (!this.contentPreferencesLoaded) {
          this.contentPreferences = preferences;
          this.contentPreferencesLoaded = true;
        }
      }).finally(() => { this.contentPreferencesLoading = null; });
    }
    await this.contentPreferencesLoading;
  }

  /** Serialize a critical section after the current one; the queue itself
   * never dies (a failed section doesn't poison later ones). */
  private enqueue(section: () => Promise<void>): Promise<void> {
    const run = this.queue.then(section);
    this.queue = run.catch(() => {});
    return run;
  }

  /** The user is looking at the app again: clear the running tally (and the
   * dedup set with it) and dismiss the standing notification. Queued so it
   * can't interleave with an in-flight present. */
  private resetPending(): void {
    this.clearPendingState();
    void this
      .enqueue(async () => {
        this.clearPendingState();
        await platform.notifications.dismissAll();
      })
      .catch(() => {
        // Clearing a stale notification is best-effort.
      });
  }

  /** Start one bounded aggregation window from the first qualifying message. */
  private scheduleFlush(): Promise<void> {
    if (this.scheduledFlush) return this.scheduledFlush.promise;

    let resolve!: () => void;
    let reject!: (error: unknown) => void;
    const promise = new Promise<void>((resolvePromise, rejectPromise) => {
      resolve = resolvePromise;
      reject = rejectPromise;
    });
    let scheduled!: ScheduledFlush;
    scheduled = {
      cancelTimer: scheduleBackgroundDeadline(() => {
        this.runScheduledFlush(scheduled);
      }, NOTIFICATION_AGGREGATION_WINDOW_MS),
      flushing: false,
      promise,
      resolve,
      reject,
    };
    this.scheduledFlush = scheduled;
    return promise;
  }

  /** Complete a timer-backed aggregate from either RN's timer or a native pulse. */
  private runScheduledFlush(scheduled: ScheduledFlush): void {
    if (scheduled.flushing) return;
    scheduled.flushing = true;
    void this
      .enqueue(async () => {
        try {
          await this.flushAggregate();
        } finally {
          // Clear inside the serialized section: work that joined the window
          // before this flush is included; later work opens a new one.
          if (this.scheduledFlush === scheduled) this.scheduledFlush = null;
        }
      })
      .then(scheduled.resolve, scheduled.reject);
  }

  /** Post one privacy-configured notification for everything in the window. */
  private async flushAggregate(): Promise<void> {
    const epoch = this.notificationEpoch;
    if (this.pendingCount === 0) return;
    if (!platform.notifications.isAvailable()) return;
    // The user may return during the aggregation window.
    if (!platform.notifications.shouldNotifyNow()) return;
    // Quiet hours may have started during the aggregation window: drop the
    // pending aggregate so it is not delivered after the window ends.
    if (await isDndActiveNow()) {
      this.pendingCount = 0;
      this.latestPendingRumor = null;
      return;
    }
    // The user may have revoked the OS grant since enabling the preference —
    // re-check at the actual delivery boundary.
    if (!(await platform.notifications.hasPermission())) {
      await this.handlePermissionLoss();
      return;
    }

    const count = this.pendingCount;
    await this.ensureContentPreferencesLoaded();
    const accountPubkey = await getActiveAccountPubkey();
    const latestPendingRumor = this.latestPendingRumor;
    if (!accountPubkey || !latestPendingRumor) return;
    const { title, subtitle, body, avatarUrl, communication } = await buildNotificationContent(
      latestPendingRumor, count, accountPubkey, this.contentPreferences,
    );

    // This app owns a single notification surface. Clearing first also removes
    // a stale aggregate left by a previous JS process, so replacement does not
    // depend on an in-memory notification id.
    await platform.notifications.dismissAll();
    if (!platform.notifications.shouldNotifyNow()) return;
    if (IS_DEVELOPMENT_BUILD && process.env.NODE_ENV !== 'test') {
      console.info(`[notifications] Presenting aggregate; count = ${count}`);
    }
    const badgeCount = accountPubkey && (await getUnreadIndicatorsEnabled())
      ? await getMainInboxUnreadCount(accountPubkey)
      : 0;
    if (epoch !== this.notificationEpoch || this.isReceiveBlocked(accountPubkey)) return;
    const presented = await platform.notifications.present({
      title,
      subtitle,
      body,
      avatarUrl,
      communication,
      badgeCount,
    });
    // Presentation can fail transiently on desktop. Only persistently disable
    // the preference when the OS grant is actually gone; otherwise the next
    // message remains eligible for another delivery attempt.
    if (!presented && !(await platform.notifications.hasPermission())) {
      await this.handlePermissionLoss();
    }
  }

  private clearPendingState(): void {
    this.notificationEpoch++;
    if (this.scheduledFlush && !this.scheduledFlush.flushing) {
      this.scheduledFlush.cancelTimer();
      this.scheduledFlush.resolve();
      this.scheduledFlush = null;
    }
    this.pendingCount = 0;
    this.latestPendingRumor = null;
    this.processedIds.clear();
  }

  private async handlePermissionLoss(): Promise<void> {
    this.statusRevision += 1;
    this.cachedStatus = { enabled: false, granted: false };
    this.enabled = false;
    pushRegistrationService.setEnabled(false);
    this.clearPendingState();
    await setNotificationsEnabled(false);
    await this.syncBackgroundMessaging();
    await platform.notifications.dismissAll();
    void pushRegistrationService.reconcile();
  }

  // ---- Settings surface ----

  /** Synchronous snapshots read only settled in-memory data, never storage or OS APIs. */
  getCachedStatus(): NotificationStatus | null { return this.cachedStatus; }
  getCachedContentPreferences(): NotificationContentPreferences | null {
    return this.contentPreferencesLoaded ? this.contentPreferences : null;
  }
  getCachedDndWindow(): DndWindow | null { return this.dndWindow; }

  /** Prepare the small device settings before navigation without requesting OS permission. */
  async prepareSettings(): Promise<void> {
    await Promise.allSettled([...this.settingsWrites]);
    await Promise.all([this.getContentPreferences(), this.getDndWindow(), unreadCountService.getIndicatorsEnabled()]);
    if (this.cachedStatus == null) await this.getStatus();
  }

  async getStatus(): Promise<NotificationStatus> {
    const revision = this.statusRevision;
    const available = platform.notifications.isAvailable();
    const granted = available && await platform.notifications.hasPermission();
    const status = { enabled: available && this.enabled, granted };
    if (revision === this.statusRevision) this.cachedStatus = status;
    return status;
  }

  async getContentPreferences(): Promise<NotificationContentPreferences> {
    await this.ensureContentPreferencesLoaded();
    return this.contentPreferences;
  }

  async setContentPreferences(preferences: NotificationContentPreferences): Promise<void> {
    await this.trackSettingsWrite(setNotificationContentPreferences(preferences).then(() => {
      this.contentPreferences = preferences;
      this.contentPreferencesLoaded = true;
    }));
  }

  async getDndWindow(): Promise<DndWindow> {
    if (this.dndWindow) return this.dndWindow;
    if (!this.dndLoading) {
      this.dndLoading = getDndWindow().then(window => {
        this.dndWindow ??= window;
        return this.dndWindow;
      }).finally(() => { this.dndLoading = null; });
    }
    return this.dndLoading;
  }

  async setDndWindow(window: DndWindow): Promise<void> {
    await this.trackSettingsWrite(setDndWindow(window).then(() => { this.dndWindow = window; }));
  }

  private async trackSettingsWrite(write: Promise<void>): Promise<void> {
    this.settingsWrites.add(write);
    try { await write; } finally { this.settingsWrites.delete(write); }
  }

  /** Turn notifications on: request OS permission, persist the preference, schedule
   * the background poll. Returns the resulting status so the UI can surface a
   * denied (or unavailable) state. */
  async enable(): Promise<NotificationStatus> {
    this.statusRevision += 1;
    if (!platform.notifications.isAvailable()) {
      this.cachedStatus = { enabled: false, granted: false };
      return this.cachedStatus;
    }
    const granted = await platform.notifications.ensurePermission(
      i18n.t('notifications.channel_name'),
    );
    if (!granted) {
      await this.handlePermissionLoss();
      return { enabled: false, granted: false };
    }
    await this.requestBatteryOptimizationExemptionOnce();
    this.enabled = true;
    await setNotificationsEnabled(true);
    pushRegistrationService.setEnabled(true);
    this.wireNative(); // set up handler/channel/tap listener now, no restart needed
    await retryUnreadIndicator();
    await this.syncBackgroundMessaging();
    void pushRegistrationService.reconcile();
    this.cachedStatus = { enabled: true, granted: true };
    return this.cachedStatus;
  }

  async disable(): Promise<void> {
    this.statusRevision += 1;
    this.cachedStatus = { enabled: false, granted: this.cachedStatus?.granted ?? false };
    this.enabled = false;
    pushRegistrationService.setEnabled(false);
    await setNotificationsEnabled(false);
    this.clearPendingState();
    await this.enqueue(async () => {
      this.clearPendingState();
      await this.syncBackgroundMessaging();
      await platform.notifications.dismissAll();
    });
    void pushRegistrationService.reconcile();
  }
}

export const notificationService = new NotificationService();
