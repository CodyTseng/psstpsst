import { DangerCircle as CircleAlert } from '@solar-icons/react-native/category/ui/Linear/DangerCircle';
import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { InteractivePressable as Pressable } from '@/components/common/InteractivePressable';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ChatComposerFeedbackSlot } from '@/components/chat/ChatComposerFeedbackSlot';
import { AppText } from '@/components/common/AppText';
import { ChromeBackdrop } from '@/components/common/ChromeBackdrop';
import { InteractionOverlay } from '@/components/common/InteractionOverlay';
import { getBottomChromeInset } from '@/lib/layout/bottom-chrome';
import { bottomBarHeight, useThemeColors } from '@/theme';

type Props = {
  aboveInput?: ReactNode;
  status: 'checking' | 'unsupported' | 'proximity_identity_changed' | 'group_read_only';
  /** Open the reason sheet. Only meaningful for `unsupported`. */
  onPressDetails: () => void;
};

type FrameProps = {
  aboveInput?: ReactNode;
  children?: ReactNode;
  onPress?: () => void;
};

/** Stable composer chrome used by every support-gate state. */
function ChatComposerFrame({ children, aboveInput, onPress }: FrameProps) {
  const c = useThemeColors();
  const insets = useSafeAreaInsets();
  const [feedbackHeight, setFeedbackHeight] = useState(0);
  const safe = getBottomChromeInset(insets.bottom);
  const bar = {
    minHeight: bottomBarHeight,
    paddingHorizontal: 16,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: c.border,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  } as const;

  return (
    <View pointerEvents="box-none" style={{ marginTop: -(bottomBarHeight + safe + feedbackHeight), zIndex: 1 }}>
      <View pointerEvents="none" style={{ position: 'absolute', top: feedbackHeight, bottom: 0, start: 0, end: 0 }}>
        <ChromeBackdrop scrollbarOcclusion="bottom" />
      </View>
      <ChatComposerFeedbackSlot
        height={feedbackHeight}
        onHeightChange={(height) => setFeedbackHeight((current) => Math.max(current, height))}
      >{aboveInput}</ChatComposerFeedbackSlot>
      {onPress ? (
        <Pressable
          onPress={onPress}
          fallbackHoverOpacity={false}
          style={bar}
        >
          {({ pressed }) => (
            <>
              {pressed ? <InteractionOverlay /> : null}
              {children}
            </>
          )}
        </Pressable>
      ) : (
        <View style={bar}>{children}</View>
      )}
      <View style={{ height: safe }} />
    </View>
  );
}

/**
 * Stands in for the composer while we don't yet know — or already know we can't —
 * message the counterparty.
 *   - `checking`: a brief inline spinner during the DM-support lookup, so the
 *     input never flashes usable before we know delivery is possible.
 *   - `unsupported`: a muted, tappable notice that opens the reason sheet.
 *   - `proximity_identity_changed`: a read-only history notice.
 * Mirrors `ChatInput`'s geometry exactly — a `bottomBarHeight` bar (hairline top
 * border) over a safe-area panel — so the bottom of the screen doesn't shift
 * when the gate is swapped for the real composer after the DM-support check.
 */
export function ChatComposerGate({ status, aboveInput, onPressDetails }: Props) {
  const { t } = useTranslation();
  const c = useThemeColors();

  return (
    <ChatComposerFrame
      aboveInput={aboveInput}
      onPress={status === 'unsupported' ? onPressDetails : undefined}
    >
      {status === 'checking' ? (
        <>
          <ActivityIndicator size="small" color={c.textMuted} />
          <AppText variant="body" tone="muted">
            {t('composer.checking')}
          </AppText>
        </>
      ) : (
        <>
          <CircleAlert size={18} color={c.warning} />
          <AppText variant="body" tone="muted">
            {status === 'proximity_identity_changed'
              ? t('nearby.account_changed_history')
              : status === 'group_read_only'
                ? t('group.read_only')
                : t('composer.unavailable')}
          </AppText>
        </>
      )}
    </ChatComposerFrame>
  );
}
