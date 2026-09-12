import Pause from 'lucide-react-native/icons/pause';
import { useTranslation } from 'react-i18next';
import type { ReactNode } from 'react';
import { View } from 'react-native';
import Svg, { Circle } from 'react-native-svg';

import { useActiveAccount } from '@/stores/active-account.store';
import { useAttachmentTransfer } from '@/stores/attachment-transfer.store';
import { iconStrokeWidth } from '@/theme/icons';
import { useThemeColors } from '@/theme';

const COMPACT_SIZE = 40;
const MEDIA_SIZE = 56;
const COMPACT_STROKE = 3;
const MEDIA_STROKE = 4;
const COMPACT_ICON_SIZE = 18;
const MEDIA_ICON_SIZE = 22;

export function AttachmentTransferProgress({
  messageId,
  size = 'compact',
  tone = 'neutral',
  fallback = null,
  fallbackPercent,
  showPause = true,
  pauseAvailable = showPause,
}: {
  messageId?: string;
  size?: 'compact' | 'media';
  tone?: 'neutral' | 'media' | 'onAccent';
  fallback?: ReactNode;
  /** Render a real ring before byte-level progress becomes available. */
  fallbackPercent?: number;
  /** Publishing may complete the ring after the cancellation window closes. */
  showPause?: boolean;
  /** Keep a stable visual icon after the pause action itself is no longer available. */
  pauseAvailable?: boolean;
}) {
  const { t } = useTranslation();
  const c = useThemeColors();
  const accountPubkey = useActiveAccount((state) => state.activePubkey);
  const transfer = useAttachmentTransfer(accountPubkey, messageId);
  const rawPercent = transfer?.percent ?? fallbackPercent;
  if (rawPercent == null) return fallback;
  const percent = Math.max(0, Math.min(100, rawPercent));

  const diameter = size === 'media' ? MEDIA_SIZE : COMPACT_SIZE;
  const strokeWidth = size === 'media' ? MEDIA_STROKE : COMPACT_STROKE;
  const iconSize = size === 'media' ? MEDIA_ICON_SIZE : COMPACT_ICON_SIZE;
  const circleRadius = (diameter - strokeWidth * 2) / 2;
  const circumference = 2 * Math.PI * circleRadius;
  const progressColor =
    tone === 'media'
      ? c.onOverlay
      : tone === 'onAccent'
        ? c.accentForeground
        : c.accent;
  const trackColor =
    tone === 'media'
      ? c.textMuted
      : tone === 'onAccent'
        ? c.accentForegroundSoft
        : c.border;
  const backgroundColor = tone === 'media' ? c.overlay : undefined;
  const sourceLabel = transfer
    ? transfer.source === 'bluetooth'
      ? t('attach.transfer_bluetooth')
      : t('settings.media_servers')
    : undefined;
  const accessibilityLabel = pauseAvailable
    ? [t('common.pause'), sourceLabel].filter(Boolean).join(', ')
    : sourceLabel;

  return (
    <View
      accessibilityRole="progressbar"
      accessibilityLabel={accessibilityLabel}
      accessibilityValue={{ min: 0, max: 100, now: percent }}
      style={{
        width: diameter,
        height: diameter,
        borderRadius: diameter / 2,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor,
      }}
      pointerEvents="none"
    >
      <Svg
        width={diameter}
        height={diameter}
        viewBox={`0 0 ${diameter} ${diameter}`}
        style={{ position: 'absolute' }}
      >
        <Circle
          cx={diameter / 2}
          cy={diameter / 2}
          r={circleRadius}
          fill="none"
          stroke={trackColor}
          strokeWidth={strokeWidth}
        />
        <Circle
          cx={diameter / 2}
          cy={diameter / 2}
          r={circleRadius}
          fill="none"
          stroke={progressColor}
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeDasharray={`${circumference} ${circumference}`}
          strokeDashoffset={circumference * (1 - percent / 100)}
          transform={`rotate(-90 ${diameter / 2} ${diameter / 2})`}
        />
      </Svg>
      {showPause ? <Pause strokeWidth={iconStrokeWidth.default} size={iconSize} color={progressColor} /> : null}
    </View>
  );
}
