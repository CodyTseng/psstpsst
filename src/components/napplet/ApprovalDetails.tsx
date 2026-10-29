import type { ComponentProps, ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { AppCard } from '@/components/common/AppCard';
import { AppText } from '@/components/common/AppText';
import { spacing } from '@/theme';

/** Request values use body text; labels and technical metadata use captions. */
export function ApprovalText({ style, ...props }: ComponentProps<typeof AppText>) {
  return <AppText variant="body" weight="regular" {...props} selectable={false} style={[style, styles.text]} />;
}

/** Related request fields share one surface and consistent section spacing. */
export function ApprovalDetails({ children }: { children: ReactNode }) {
  return <AppCard variant="muted" style={{ gap: spacing.lg }}>{children}</AppCard>;
}

export function ApprovalField({ label, children }: { label: string; children: ReactNode }) {
  return <View style={{ gap: spacing.sm }}>
    <ApprovalText variant="caption" tone="muted">{label}</ApprovalText>
    {children}
  </View>;
}

const styles = StyleSheet.create({ text: { userSelect: 'none' } });
