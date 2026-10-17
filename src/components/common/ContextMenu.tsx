import { useLayoutEffect, useRef, useState } from 'react';
import { Modal, StyleSheet, useWindowDimensions, View } from 'react-native';

import { InteractivePressable as Pressable } from '@/components/common/InteractivePressable';

import { desktopChrome, spacing } from '@/theme';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { IS_ELECTRON } from '@/lib/platform';

import {
  ACTION_MENU_ICON_SIZE,
  ACTION_MENU_METRICS,
  ActionMenuPanel,
  actionMenuHeight,
  type ActionMenuDensity,
  type ActionMenuItem,
} from './ActionMenuPanel';
import { useFocusedOverlayDismiss } from './use-focused-overlay-dismiss';

export type ContextMenuAnchor = {
  x: number;
  y: number;
  width?: number;
  height?: number;
};

export type ContextMenuItem = ActionMenuItem;
export type ContextMenuDensity = ActionMenuDensity;
export type ContextMenuPlacement = 'above' | 'below';
export const CONTEXT_MENU_ICON_SIZE = ACTION_MENU_ICON_SIZE;

type Props = {
  anchor: ContextMenuAnchor;
  items: ContextMenuItem[];
  onClose: () => void;
  align?: 'start' | 'end' | 'center';
  density?: ContextMenuDensity;
  placement?: ContextMenuPlacement | 'auto';
  /** Reports the resolved side so anchored content can avoid covering nearby labels. */
  onPlacementChange?: (placement: ContextMenuPlacement) => void;
  /** Keep the original press stream alive when a hold can continue into dragging. */
  inline?: boolean;
};

/** Shared anchored menu; inline presentation preserves held gesture streams. */
export function ContextMenu({ inline = false, ...props }: Props) {
  useFocusedOverlayDismiss(true, props.onClose);
  if (inline) return <InlineContextMenu {...props} />;
  return (
    <Modal visible transparent statusBarTranslucent onRequestClose={props.onClose}>
      <ContextMenuOverlay {...props} />
    </Modal>
  );
}

/** Measure the containing pane so global pointer anchors remain correct in split layouts. */
function InlineContextMenu(props: Props) {
  const root = useRef<View>(null);
  const [bounds, setBounds] = useState<{ x: number; y: number; width: number; height: number } | null>(null);
  return <View ref={root} testID="inline-context-menu" style={styles.overlay} onLayout={() => {
    root.current?.measureInWindow((x, y, width, height) => setBounds({ x, y, width, height }));
  }}>
    {bounds ? <ContextMenuOverlay {...props} viewportSize={bounds}
      anchor={{ ...props.anchor, x: props.anchor.x - bounds.x, y: props.anchor.y - bounds.y }} /> : null}
  </View>;
}

/** Anchored menu inside an existing modal; never opens a second native modal. */
export function ContextMenuOverlay({
  anchor, items, onClose, align = 'start', density = 'pointer', placement = 'below', onPlacementChange, viewportSize,
}: Props & { viewportSize?: { width: number; height: number; y?: number } }) {
  const window = useWindowDimensions();
  const { width, height } = viewportSize ?? window;
  const insets = useSafeAreaInsets();
  const metrics = ACTION_MENU_METRICS[density];
  const originY = viewportSize?.y ?? 0;
  const safeTop = IS_ELECTRON ? desktopChrome.titlebarHeight : insets.top;
  const topEdge = metrics.edgeMargin + Math.max(0, safeTop - originY);
  const bottomEdge = metrics.edgeMargin + Math.max(0, originY + height - (window.height - insets.bottom));
  const menuHeight = actionMenuHeight(items, density);
  const anchoredLeft = align === 'center' ? anchor.x + (anchor.width ?? 0) / 2 - metrics.width / 2
    : align === 'end' ? anchor.x - metrics.width : anchor.x;
  const left = Math.max(
    metrics.edgeMargin,
    Math.min(anchoredLeft, width - metrics.edgeMargin - metrics.width),
  );
  const gap = placement === 'auto' ? spacing.sm : 0;
  const above = anchor.y - gap - menuHeight;
  const below = anchor.y + (anchor.height ?? 0) + gap;
  const fitsAbove = above >= topEdge;
  const fitsBelow = below + menuHeight <= height - bottomEdge;
  const preferAbove = placement === 'above' || (placement === 'auto' &&
    (fitsAbove || (!fitsBelow && anchor.y - topEdge > height - bottomEdge - anchor.y - (anchor.height ?? 0))));
  const top = Math.max(
    topEdge,
    Math.min(preferAbove ? above : below, height - bottomEdge - menuHeight),
  );

  useLayoutEffect(() => {
    onPlacementChange?.(preferAbove ? 'above' : 'below');
  }, [onPlacementChange, preferAbove]);

  function run(item: ContextMenuItem) {
    onClose();
    setTimeout(item.onPress, 0);
  }

  return (
    <View style={[styles.overlay, { pointerEvents: 'box-none' }]}>
      <Pressable
        accessible={false}
        tabIndex={-1}
        style={[StyleSheet.absoluteFill, IS_ELECTRON && styles.desktopBackdrop]}
        onPress={onClose}
      />
      <ActionMenuPanel
        density={density}
        items={items}
        onSelect={run}
        style={{ position: 'absolute', top, left }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    start: 0,
    end: 0,
    zIndex: 20,
    elevation: 20,
  },
  desktopBackdrop: {
    outlineWidth: 0,
  },
});
