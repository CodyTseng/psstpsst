import type { ComponentProps, Ref } from 'react';
import { useWindowDimensions, type View } from 'react-native';
import { AppButton } from '@/components/common/AppButton';
import type { GridApp } from '@/services/explore/model';
import { spacing, typography } from '@/theme';
import { RunningApplicationIcon } from './RunningApplicationIcon';
import { useApplicationRunning } from '@/stores/application-presence.store';
import { useTranslation } from 'react-i18next';

/** All app grids share their columns, typography and font-scaled row geometry. */
export function useApplicationGridMetrics(width: number) {
  const { fontScale } = useWindowDimensions();
  // Use the measured pane width, so split panes follow the same density as phones.
  const densityUnit = spacing['3xl'] + spacing.xl;
  // Preserve recognizable artwork before adding another column.
  const iconSize = width < densityUnit * 5
    ? spacing['3xl'] + spacing.md : spacing['3xl'] + spacing.lg + spacing.xs;
  const cellWidth = iconSize + spacing.sm;
  const interactionInset = spacing.xs;
  const targetStep = iconSize + spacing.lg + spacing.xs;
  const columns = Math.max(1, Math.round(width / targetStep));
  const columnGap = columns > 1 ? Math.max(0, (width - iconSize) / (columns - 1) - cellWidth) : 0;
  return {
    columns,
    iconSize,
    cellWidth,
    columnGap,
    columnStep: cellWidth + columnGap,
    gridInset: spacing.lg - interactionInset,
    cellHeight: iconSize + spacing['3xl'] + Math.max(0, Math.ceil(typography.caption.lineHeight * (fontScale - 1))),
  };
}

type Props = Pick<ComponentProps<typeof AppButton>,
  'onPress' | 'onLongPress' | 'accessibilityActions' | 'onAccessibilityAction'> & {
  app: GridApp;
  iconSize: number;
  iconRef?: Ref<View>;
  hideLabel?: boolean;
};

export function ApplicationTile({ app, iconSize, iconRef, hideLabel = false, ...actions }: Props) {
  const running = useApplicationRunning(app.key), { t } = useTranslation();
  return <AppButton variant="ghost" corner="none" compact compactAxis="none" label={app.title} labelHidden={hideLabel} labelVariant="caption" labelNumberOfLines={1}
    orientation="vertical" interactionFeedback="iconOpacity" accessibilityLabel={running ? `${app.title}, ${t('applications.running')}` : app.title} {...actions}
    iconLeft={<RunningApplicationIcon sourceId={app.key} release={app} size={iconSize} iconRef={iconRef} />} />;
}
