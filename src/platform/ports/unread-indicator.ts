/**
 * Mirrors the Chats unread total into platform-owned application chrome: the
 * app-icon badge on iOS/Android, the tray count plus macOS dock badge on
 * desktop. `0` clears it. Best-effort — badge support varies by launcher and
 * OS grant. Implementations never reject and report whether the write reached
 * platform chrome, allowing callers to retry after permission is granted.
 */
export interface UnreadIndicatorPort {
  setCount(count: number): Promise<boolean>;
}
