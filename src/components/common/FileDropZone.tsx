import { type ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

import { AppCard } from '@/components/common/AppCard';
import { AppText } from '@/components/common/AppText';
import { useFileDrop } from '@/hooks/use-file-drop';
import { type ComposerFile } from '@/lib/attachments/composer-file';
import { contentWidth, spacing, useThemeColors } from '@/theme';

type Props = {
  children: ReactNode;
  title: string;
  hint: string;
  icon: ReactNode;
  enabled: boolean;
  onDropFiles: (files: ComposerFile[]) => void;
};

/** Scoped cross-platform file drop feedback with drag state kept local. */
export function FileDropZone({ children, enabled, onDropFiles, title, hint, icon }: Props) {
  const c = useThemeColors();
  const { targetRef, active } = useFileDrop({ enabled, onDropFiles });

  const content = (
    <View style={{ flex: 1 }}>
      {children}
      {active ? (
        <View
          accessibilityLiveRegion="polite"
          accessibilityRole="alert"
          pointerEvents="none"
          style={[
            StyleSheet.absoluteFill,
            {
              zIndex: 20,
              backgroundColor: c.sheetBackdrop,
              alignItems: 'center',
              justifyContent: 'center',
              paddingHorizontal: spacing.xl,
            },
          ]}
        >
          <AppCard
            variant="plain"
            style={{
              width: '100%',
              maxWidth: contentWidth.dialog,
              alignItems: 'center',
              gap: spacing.md,
            }}
          >
            <View
              style={{
                width: spacing['3xl'],
                height: spacing['3xl'],
                borderRadius: spacing.xl,
                backgroundColor: c.accentSoft,
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              {icon}
            </View>
            <View style={{ gap: spacing.xs }}>
              <AppText variant="subtitle" weight="semibold" align="center">
                {title}
              </AppText>
              <AppText variant="caption" tone="muted" align="center">
                {hint}
              </AppText>
            </View>
          </AppCard>
        </View>
      ) : null}
    </View>
  );

  return (
    <View ref={targetRef} style={{ flex: 1 }}>
      {content}
    </View>
  );
}
