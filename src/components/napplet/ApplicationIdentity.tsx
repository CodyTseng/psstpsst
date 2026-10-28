import { View } from 'react-native';
import { useRef, useState, type ReactNode } from 'react';
import { AppText } from '@/components/common/AppText';
import type { ApplicationIconSource } from '@/services/explore/icons';
import { spacing } from '@/theme';
import { ApplicationIcon } from './ApplicationIcon';

export type IdentityAction = ReactNode | ((inline: boolean) => ReactNode);

/** App identity shared by information surfaces and compact permission contexts. */
export function ApplicationIdentity({ release, compact = false, iconSize, titleVariant, action, subtitle, wrapActions = false, onPlacementReady }: { release: ApplicationIconSource & { title: string }; compact?: boolean; iconSize?: number; titleVariant?: 'body' | 'subtitle' | 'title'; action?: IdentityAction; subtitle?: string; wrapActions?: boolean; onPlacementReady?: () => void }) {
  const [actionsInline, setActionsInline] = useState(false);
  const layout = useRef({ width: 0, actionsWidth: 0, inline: false });
  const gap = compact ? spacing.md : spacing.lg;
  const updatePlacement = () => {
    const measured = layout.current;
    if (!measured.width || !measured.actionsWidth) return;
    // Reserve at least half the available row for the application's identity.
    const inline = measured.actionsWidth + gap <= measured.width / 2;
    if (inline !== measured.inline) {
      measured.inline = inline;
      setActionsInline(inline);
    }
    onPlacementReady?.();
  };
  const stacked = wrapActions && !actionsInline;
  const renderedAction = typeof action === 'function' ? action(!stacked) : action;
  const identity = <>
    <ApplicationIcon release={release} size={iconSize ?? (compact ? spacing['2xl'] : spacing['3xl'])} />
    <View style={{ flex: 1, minWidth: 0, gap: spacing.xs }}>
      <AppText variant={titleVariant ?? (compact ? 'subtitle' : 'title')} numberOfLines={compact ? 1 : 2}
        selectable={false} style={{ minWidth: 0, userSelect: 'none' }}>{release.title}</AppText>
      {subtitle ? <AppText variant="caption" tone="muted">{subtitle}</AppText> : null}
    </View>
  </>;
  return <View testID="application-identity" onLayout={wrapActions ? event => {
    layout.current.width = event.nativeEvent.layout.width;
    updatePlacement();
  } : undefined} style={{ flexDirection: stacked ? 'column' : 'row', alignItems: stacked ? 'stretch' : 'center', gap }}>
    {wrapActions ? <View style={{ flex: stacked ? undefined : 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap }}>{identity}</View> : identity}
    {renderedAction ? <View onLayout={wrapActions ? event => {
      layout.current.actionsWidth = event.nativeEvent.layout.width;
      updatePlacement();
    } : undefined} style={{ flexShrink: 0, alignSelf: stacked ? 'flex-start' : undefined, maxWidth: '100%' }}>{renderedAction}</View> : null}
  </View>;
}
