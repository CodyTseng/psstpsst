import { AppText } from '@/components/common/AppText';
import { formatListTime } from '@/lib/time';
import { useDateTimePreferences } from '@/stores/date-time.store';

/** Keep format subscriptions local and visible to React Compiler's dependency analysis. */
export function ConversationTimestamp({ timestamp, nowTs }: { timestamp: number; nowTs?: number }) {
  const preferences = useDateTimePreferences();
  const label = formatListTime(timestamp, nowTs, preferences);
  return <AppText variant="caption" tone="subtle" weight="regular" numberOfLines={1} style={{ flexShrink: 0 }}>
    {label}
  </AppText>;
}
