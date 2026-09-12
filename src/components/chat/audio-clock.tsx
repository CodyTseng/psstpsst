import { AppText } from '@/components/common/AppText';
import { formatPlayerClock } from '@/lib/audio/voice';

export function AudioClock({
  seconds,
  totalSeconds = seconds,
  color,
  align = 'start',
}: {
  seconds: number;
  totalSeconds?: number;
  color: string;
  align?: 'start' | 'end';
}) {
  return (
    <AppText
      variant="code"
      weight="semibold"
      align={align}
      style={{ color, fontVariant: ['tabular-nums'] }}
    >
      {formatPlayerClock(seconds, totalSeconds)}
    </AppText>
  );
}
