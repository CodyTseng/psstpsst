import { eq } from 'drizzle-orm';

import { db } from '@/db/client';
import { devicePreferences } from '@/db/schema';
import { useLiveQuery } from '@/db/use-live-query';
import { QUIET_MESSAGE_REQUESTS_KEY } from '@/services/notifications/notification-prefs';

/** Observe device settings in tabs and Settings, including external writes. */
export function useQuietMessageRequests() {
  const { data, isResolved } = useLiveQuery(
    db.select({ value: devicePreferences.value }).from(devicePreferences)
      .where(eq(devicePreferences.key, QUIET_MESSAGE_REQUESTS_KEY)).limit(1),
  );
  return { quiet: data[0]?.value === '1', resolved: isResolved };
}
