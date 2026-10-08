import { Copy } from '@solar-icons/react-native/category/ui/Linear/Copy';
import Download from 'lucide-react-native/icons/download';
import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { View, type StyleProp, type ViewStyle } from 'react-native';

import {
  ContextMenu,
  CONTEXT_MENU_ICON_SIZE,
  type ContextMenuAnchor,
  type ContextMenuItem,
} from '@/components/common/ContextMenu';
import { desktopContextMenuPoint, IS_ELECTRON, type DesktopContextMenuEvent } from '@/lib/platform';
import { showToast } from '@/stores/toast.store';
import { useThemeColors } from '@/theme';
import { iconStrokeWidth } from '@/theme/icons';

type Props = {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  disabled?: boolean;
  onCopy?: () => Promise<void>;
  onSave: () => Promise<void>;
};

/** Capture the visible media's actions when the pointer menu opens. */
export function MediaViewerContextMenu({ children, style, disabled, onCopy, onSave }: Props) {
  const { t } = useTranslation();
  const c = useThemeColors();
  const [copying, setCopying] = useState(false);
  const [menu, setMenu] = useState<{ anchor: ContextMenuAnchor; items: ContextMenuItem[] } | null>(null);

  function open(event: DesktopContextMenuEvent) {
    event.preventDefault?.();
    event.stopPropagation?.();
    const anchor = desktopContextMenuPoint(event);
    if (!anchor || disabled || copying) return;
    const copy = onCopy;
    setMenu({ anchor, items: [
      ...(copy ? [{
        key: 'copy', title: t('chat.actions.copy'),
        icon: <Copy size={CONTEXT_MENU_ICON_SIZE.pointer} color={c.text} />,
        onPress: () => {
          setCopying(true);
          void copy().then(
            () => showToast(t('common.copied')),
            () => showToast(t('attach.copy_failed')),
          ).finally(() => setCopying(false));
        },
      }] : []),
      {
        key: 'save', title: t('chat.actions.save'),
        icon: <Download size={CONTEXT_MENU_ICON_SIZE.pointer} color={c.text} strokeWidth={iconStrokeWidth.default} />,
        onPress: () => { void onSave(); },
      },
    ] });
  }

  return (
    <View style={style} {...(IS_ELECTRON ? { onContextMenu: open } : {})}>
      {children}
      {IS_ELECTRON && !disabled && menu ? (
        <ContextMenu anchor={menu.anchor} items={menu.items} onClose={() => setMenu(null)} />
      ) : null}
    </View>
  );
}
