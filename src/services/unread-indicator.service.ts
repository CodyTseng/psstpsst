import { platform } from '@/platform';

let requestedCount: number | undefined;
let synchronizedCount: number | undefined;

/** Keep platform chrome aligned with unread state without repeating identical IPC. */
export async function syncUnreadIndicator(count: number): Promise<void> {
  const normalized = Number.isSafeInteger(count) && count > 0 ? count : 0;
  requestedCount = normalized;
  if (normalized === synchronizedCount) return;
  if (await platform.unreadIndicator.setCount(normalized)) synchronizedCount = normalized;
}

/** Retry the latest requested count after notification/badge permission changes. */
export async function retryUnreadIndicator(): Promise<void> {
  if (requestedCount === undefined || requestedCount === synchronizedCount) return;
  if (await platform.unreadIndicator.setCount(requestedCount)) synchronizedCount = requestedCount;
}
