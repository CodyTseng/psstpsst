import { type ReactNode, useEffect, useRef } from 'react';
import { Modal, StyleSheet, View } from 'react-native';

import { InteractivePressable as Pressable } from '@/components/common/InteractivePressable';
import { contentWidth, radius, shadow, spacing, useThemeColors } from '@/theme';

type Props = {
  visible: boolean;
  onClose: () => void;
  onClosed?: () => void;
  accessibilityLabel?: string;
  maxWidth?: number;
  children: ReactNode;
};

/** Centered Electron dialog chrome without prescribing header, body, or actions. */
export function DialogSurface({
  visible,
  onClose,
  onClosed,
  accessibilityLabel,
  maxWidth = contentWidth.dialog,
  children,
}: Props) {
  const c = useThemeColors();
  const wasVisible = useRef(visible);

  useEffect(() => {
    if (wasVisible.current && !visible) onClosed?.();
    wasVisible.current = visible;
  }, [visible, onClosed]);

  useEffect(() => {
    if (!visible || typeof document === 'undefined') return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [visible, onClose]);

  if (!visible) return null;

  return (
    <Modal transparent visible onRequestClose={onClose} statusBarTranslucent>
      <View
        style={{
          flex: 1,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: c.overlay,
          padding: spacing.xl,
        }}
      >
        <Pressable
          hoverFeedback={false}
          style={StyleSheet.absoluteFill}
          onPress={onClose}
          accessibilityLabel={accessibilityLabel}
        />
        <View
          style={{
            width: '100%',
            maxWidth,
            padding: spacing.lg,
            borderRadius: radius.xl,
            backgroundColor: c.surfaceElevated,
            borderWidth: StyleSheet.hairlineWidth,
            borderColor: c.border,
            gap: spacing.lg,
            ...shadow.float,
          }}
        >
          {children}
        </View>
      </View>
    </Modal>
  );
}
