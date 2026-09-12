import { View } from 'react-native';

import { formatBadgeCount } from '@/lib/badge-count';
import { countBadge, radius, useThemeColors } from '@/theme';

import { AppText } from './AppText';

/** Badge color treatments. Every fill is a theme token (no raw hex):
 * - `notification` — the soft unread red (vs `danger`, kept for destructive); white count.
 * - `neutral` — the shared neutral overlay colour with muted text; a calm but
 *   still distinct indicator for a **muted** conversation's unread count
 *   ("present, but not clamoring" — you muted it on purpose).
 * - `neutralStrong` — a **translucent** medium-grey fill (`textMuted` at 25%)
 *   with the count in the **normal text color** (so the number matches the
 *   adjacent back chevron). Still a grey badge, but the medium-grey wash reads
 *   against a grey `background` where `neutral` stays intentionally subtle,
 *   while the transparency keeps it soft (not a heavy solid block). The
 *   chat-header Back count — an ambient "other threads are waiting" cue. */
type Tone = 'notification' | 'neutral' | 'neutralStrong';
type Size = keyof typeof countBadge;

/**
 * Pill with a `micro` count, capped at "99+". The app's standard unread /
 * notification count badge (conversation rows, tab bar, etc.). A `0` renders
 * nothing.
 */
export function CountBadge({
  count,
  tone = 'notification',
  size = 'md',
}: {
  count: number;
  tone?: Tone;
  size?: Size;
}) {
  const c = useThemeColors();
  if (count <= 0) return null;
  const metrics = countBadge[size];
  const { bg, fg } = {
    notification: { bg: c.notification, fg: c.onOverlay },
    neutral: { bg: c.interactionOverlay, fg: c.textMuted },
    neutralStrong: { bg: c.textMuted + '40', fg: c.text },
  }[tone];
  return (
    <View
      style={{
        minWidth: metrics.size,
        height: metrics.size,
        borderRadius: radius.full,
        paddingHorizontal: metrics.horizontalPadding,
        backgroundColor: bg,
        alignSelf: 'center',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <AppText variant="micro" weight="semibold" align="center" style={{ color: fg }}>
        {formatBadgeCount(count)}
      </AppText>
    </View>
  );
}
