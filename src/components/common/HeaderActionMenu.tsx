import type { ReactNode } from 'react';
import { Platform } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { IS_ELECTRON } from '@/lib/platform';

import {
  CONTEXT_MENU_ICON_SIZE,
  ContextMenu,
  type ContextMenuAnchor,
} from './ContextMenu';

export type HeaderActionMenuItem = {
  key: string;
  title: string;
  icon: ReactNode;
  onPress: () => void;
};

type Props = {
  visible: boolean;
  anchor: HeaderActionMenuAnchor | null;
  onClose: () => void;
  items: HeaderActionMenuItem[];
};

export type HeaderActionMenuAnchor = {
  x: number;
  y: number;
};

export const HEADER_ACTION_MENU_ICON_SIZE = IS_ELECTRON
  ? CONTEXT_MENU_ICON_SIZE.pointer
  : CONTEXT_MENU_ICON_SIZE.touch;

/** Top-end ScreenHeader wrapper around the shared anchored action menu. */
export function HeaderActionMenu({ visible, anchor, onClose, items }: Props) {
  const insets = useSafeAreaInsets();
  if (!visible || !anchor) return null;

  // With an edge-to-edge Android window, measureInWindow reports Y from the
  // app-content origin while a statusBarTranslucent Modal starts at the physical
  // screen origin. Keep the menu's top-right corner on the trigger's top-right.
  const menuTop = anchor.y + (Platform.OS === 'android' ? insets.top : 0);

  return (
    <ContextMenu
      anchor={{ x: anchor.x, y: menuTop } satisfies ContextMenuAnchor}
      align="end"
      density={IS_ELECTRON ? 'pointer' : 'touch'}
      items={items}
      onClose={onClose}
    />
  );
}
