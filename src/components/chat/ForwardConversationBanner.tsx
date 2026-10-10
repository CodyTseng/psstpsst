import Check from 'lucide-react-native/icons/check';
import ChevronRight from 'lucide-react-native/icons/chevron-right';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';

import { openSharedConversation } from '@/components/navigation/open-shared-conversation';
import { AppText } from '@/components/common/AppText';
import { InteractionOverlay } from '@/components/common/InteractionOverlay';
import { InteractivePressable, supportsHoverPointer } from '@/components/common/InteractivePressable';
import { useDirectionalIconStyle } from '@/i18n/direction';
import { dismissForwardNotice } from '@/services/conversation/forward-notice';
import { useForwardNotice } from '@/stores/forward-notice.store';
import { radius, spacing, uiDensity, useThemeColors } from '@/theme';
import { iconStrokeWidth } from '@/theme/icons';

const VISIBLE_MS = 2000;

/** Multi-target sends are quiet acknowledgements; only one target offers a link. */
export function ForwardConversationBanner({ accountPubkey, sourceConversationKey }: {
  accountPubkey: string;
  sourceConversationKey: string;
}) {
  const [hoveredNoticeId, setHoveredNoticeId] = useState<number | null>(null);
  const expiryTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const notice = useForwardNotice(accountPubkey, sourceConversationKey);
  const { t } = useTranslation();
  const c = useThemeColors();
  const directionalStyle = useDirectionalIconStyle();
  const noticeId = notice?.id;
  useEffect(() => {
    if (noticeId === undefined || hoveredNoticeId === noticeId) return;
    const timer = setTimeout(() => dismissForwardNotice(noticeId), VISIBLE_MS);
    expiryTimer.current = timer;
    return () => {
      clearTimeout(timer);
      if (expiryTimer.current === timer) expiryTimer.current = null;
    };
  }, [hoveredNoticeId, noticeId]);
  if (!notice) return null;

  const onHoverIn = () => {
    if (expiryTimer.current !== null) clearTimeout(expiryTimer.current);
    setHoveredNoticeId(notice.id);
  };
  const onHoverOut = () => setHoveredNoticeId(null);
  const cardStyle = {
    backgroundColor: c.surfaceElevated, borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth, borderColor: c.border, overflow: 'hidden',
  } as const;
  const content = (linked: boolean) => (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
      paddingHorizontal: spacing.md, paddingVertical: spacing.sm, minHeight: uiDensity.composerActionSize }}>
      <Check size={spacing.lg} color={c.textMuted} strokeWidth={iconStrokeWidth.compact} accessible={false} />
      <AppText variant="caption" tone="muted" style={{ flex: 1 }}>{t('share.sent')}</AppText>
      {linked ? (
        <>
          <AppText variant="caption" tone="accent" style={{ flexShrink: 1 }}>{t('share.enter_conversation')}</AppText>
          <ChevronRight size={spacing.lg} color={c.accent}
            strokeWidth={iconStrokeWidth.default} style={directionalStyle} />
        </>
      ) : null}
    </View>
  );
  const target = notice.targets[0];
  const linked = notice.targets.length === 1;

  return (
    <View style={{ paddingHorizontal: spacing.lg, paddingVertical: spacing.sm }}>
      {linked ? (
        <InteractivePressable
          onPress={() => {
            dismissForwardNotice(notice.id);
            openSharedConversation(target);
          }}
          onHoverIn={onHoverIn}
          onHoverOut={onHoverOut}
          accessibilityRole="button"
          accessibilityLabel={[target.name, t('share.sent'), t('share.enter_conversation')].filter(Boolean).join(', ')}
          fallbackHoverOpacity={false}
          style={cardStyle}
        >
          {({ pressed }) => (
            <>
              {pressed ? <InteractionOverlay /> : null}
              {content(true)}
            </>
          )}
        </InteractivePressable>
      ) : (
        <View
          accessible
          accessibilityLabel={t('share.sent')}
          onPointerEnter={(event) => {
            if (supportsHoverPointer(event.nativeEvent.pointerType)) onHoverIn();
          }}
          onPointerLeave={(event) => {
            if (supportsHoverPointer(event.nativeEvent.pointerType)) onHoverOut();
          }}
          style={cardStyle}
        >
          {content(false)}
        </View>
      )}
    </View>
  );
}
