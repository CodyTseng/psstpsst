import { Modal, StyleSheet, useWindowDimensions, View } from 'react-native';

import { InteractivePressable as Pressable } from '@/components/common/InteractivePressable';

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
};

export type ContextMenuItem = ActionMenuItem;
export type ContextMenuDensity = ActionMenuDensity;
export const CONTEXT_MENU_ICON_SIZE = ACTION_MENU_ICON_SIZE;

type Props = {
  anchor: ContextMenuAnchor;
  items: ContextMenuItem[];
  onClose: () => void;
  align?: 'start' | 'end';
  density?: ContextMenuDensity;
};

/** Shared action-menu panel mounted in a cursor/trigger-anchored Modal. */
export function ContextMenu({
  anchor,
  items,
  onClose,
  align = 'start',
  density = 'pointer',
}: Props) {
  useFocusedOverlayDismiss(true, onClose);
  const { width, height } = useWindowDimensions();
  const metrics = ACTION_MENU_METRICS[density];
  const menuHeight = actionMenuHeight(items, density);
  const anchoredLeft = align === 'end' ? anchor.x - metrics.width : anchor.x;
  const left = Math.max(
    metrics.edgeMargin,
    Math.min(anchoredLeft, width - metrics.edgeMargin - metrics.width),
  );
  const top = Math.max(
    metrics.edgeMargin,
    Math.min(anchor.y, height - metrics.edgeMargin - menuHeight),
  );

  function run(item: ContextMenuItem) {
    onClose();
    setTimeout(item.onPress, 0);
  }

  return (
    <Modal visible transparent statusBarTranslucent onRequestClose={onClose}>
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
    </Modal>
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
