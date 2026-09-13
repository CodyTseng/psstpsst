/**
 * Port for local notifications. The business rules (one counting funnel fed by
 * the live subscription and the background poll, rumor-id dedup, aggregate one
 * privacy-configured banner, never for message requests) live in
 * `services/notifications/notification.service.ts`; this port exposes only the
 * OS primitives it needs.
 *
 * Implementations must tolerate the capability being absent (Expo Go, a dev
 * client built before the native module was added, or a platform without
 * notifications): `isAvailable()` returns false and every other method becomes
 * a no-op / resolves to a benign value, so the app boots normally regardless.
 *
 * All methods are async-first — see the module note in `secure-storage.ts`.
 */
export type NotificationPresentationContent = {
  title: string;
  subtitle?: string;
  body?: string;
  avatarUrl?: string;
  badgeCount: number;
};

export interface NotificationsPort {
  /** Whether the native notification capability is present at all. */
  isAvailable(): boolean;
  /**
   * Whether a notification posted right now would reach a user who isn't
   * already looking at the app — mobile: the app is strictly backgrounded
   * (not `active`, and not the transitional `inactive` either); desktop: the
   * window is hidden or visible-but-unfocused. Sync by exception: a cached
   * in-memory OS read, like `appState.currentState`.
   */
  shouldNotifyNow(): boolean;
  /**
   * Fires when the user returns to the app (mobile foreground, desktop window
   * focus), so the service can clear its pending tally and dismiss the
   * standing notification. Sync by exception: listener registration. Returns
   * a cleanup function.
   */
  addUserReturnedListener(listener: () => void): () => void;
  /**
   * Whether the OS has granted notification permission, including iOS
   * provisional/ephemeral grants.
   */
  hasPermission(): Promise<boolean>;
  /**
   * Create the Android channel (no-op on other platforms — Android requires the
   * channel to exist before its system prompt), then request permission if the
   * OS still allows asking. Returns the final granted state.
   */
  ensurePermission(channelName: string): Promise<boolean>;
  /** Open OS notification settings when supported. Returns whether a page opened. */
  openSettings(): Promise<boolean>;
  /**
   * Set the foreground presentation handler. We only post while backgrounded,
   * so this is a sane default for edge cases; idempotent.
   */
  setDefaultHandler(): void;
  /**
   * Post a local notification immediately. `false` means the platform rejected
   * this delivery; the service rechecks the OS grant before deciding whether
   * future attempts should remain enabled. `badgeCount` is the database-derived
   * total, not the size of the latest notification batch.
   */
  present(content: NotificationPresentationContent): Promise<boolean>;
  /** Dismiss every posted notification. Never rejects. */
  dismissAll(): Promise<void>;
}
