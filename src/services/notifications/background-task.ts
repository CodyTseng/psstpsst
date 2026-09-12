import { platform } from '@/platform';
import { getActiveAccountPubkey } from '@/services/account/account.service';
import { refreshUnreadIndicator } from '@/services/conversation/unread-count.service';
import { dmService } from '@/services/dm/dm.service';
import { MessagingKeySyncRequiredError, receiveSessionStore } from '@/services/dm/receive-session';

import { getNotificationsEnabled } from './notification-prefs';

/**
 * Background poll for new messages. One periodic task on both platforms
 * (WorkManager on Android, BGTaskScheduler on iOS — behind the `backgroundTask`
 * platform port, which tolerates the native modules being absent). When the OS
 * grants a window, it refreshes receive metadata and pages the recent gift-wrap window, stores new
 * messages, and posts one aggregated privacy-configured notification. Best-effort
 * + delayed by design: it recovers Android after the resident process is gone
 * and is the primary background path on iOS. It runs only when the system
 * schedules it (~15 min minimum, opportunistic on iOS).
 */
export const BACKGROUND_POLL_TASK = 'psstpsst-background-poll';
/** Floor only — the OS decides actual cadence (15 min is the platform minimum). */
const MINIMUM_INTERVAL_MINUTES = 15;

// Define at module top level so the OS can invoke it even on a cold launch (the
// app was killed) — this module is eagerly imported from the root layout.
platform.backgroundTask.defineTasks(
  [BACKGROUND_POLL_TASK],
  async ({ signal }) => {
    if (signal.aborted) return;
    const pubkey = await getActiveAccountPubkey();
    if (!pubkey) return;
    if (!(await getNotificationsEnabled())) return;
    if (signal.aborted) return;

    let rumors;
    try {
      rumors = await dmService.pollForNotifications(pubkey, { abort: signal });
    } catch (error) {
      if (!(error instanceof MessagingKeySyncRequiredError)) throw error;
      const session = receiveSessionStore.getState();
      if (session.status !== 'key-required' || session.accountPubkey !== pubkey) return;
      // A cold worker has no mounted UI or initialized notification service.
      // Cancel durable recovery here as well; only a verified live init restores it.
      await Promise.all([
        platform.backgroundMessaging.stop(),
        unregisterBackgroundPoll(),
      ]);
      return;
    }
    if (rumors.length > 0) {
      // Required lazily to avoid a load-time cycle (notification.service →
      // background-task). By task-run time it's fully initialised.
      // eslint-disable-next-line @typescript-eslint/no-require-imports -- intentional cycle-break
      const { notificationService } = require(
        './notification.service',
      ) as typeof import('./notification.service');
      // The poll doesn't count or filter: it hands freshly-stored rumors to the
      // single funnel and refreshes the database-derived badge in parallel.
      // Awaiting the funnel also keeps a headless task alive through its short
      // delivery until the OS call completes. This poll already produced one
      // bounded batch, so it bypasses the live path's timer-backed aggregation.
      await Promise.all([
        notificationService.notifyNewRumors(rumors, { flushImmediately: true, accountPubkey: pubkey }),
        refreshUnreadIndicator(pubkey),
      ]);
    }
  },
);

export async function registerBackgroundPoll(): Promise<void> {
  await platform.backgroundTask.register(MINIMUM_INTERVAL_MINUTES);
}

export async function unregisterBackgroundPoll(): Promise<void> {
  await platform.backgroundTask.unregister();
}
