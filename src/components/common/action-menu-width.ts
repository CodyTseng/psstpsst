import { desktopUiFontFamily } from '@/theme/typography';
import { fontWeight, typography } from '@/theme';
import { ACTION_MENU_ICON_SIZE, ACTION_MENU_METRICS, type ActionMenuDensity, type ActionMenuItem } from './ActionMenuPanel';

let context: CanvasRenderingContext2D | null | undefined;
/** Measure only the opened menu's short action list, with the same font as its rows. */
export function actionMenuWidth(items: ActionMenuItem[], density: ActionMenuDensity): number {
  const metrics = ACTION_MENU_METRICS[density];
  if (typeof document === 'undefined') return metrics.width;
  context ??= document.createElement('canvas').getContext('2d');
  if (!context) return metrics.width;
  const font = typography.body;
  context.font = `${fontWeight[font.weight]} ${font.fontSize}px ${font.fontFamily ?? desktopUiFontFamily}`;
  const labelWidth = Math.max(0, ...items.map(item => context!.measureText(item.title).width));
  return Math.max(metrics.width, Math.ceil(labelWidth + metrics.rowPaddingH * 2 + metrics.iconGap + ACTION_MENU_ICON_SIZE[density] + 2));
}
