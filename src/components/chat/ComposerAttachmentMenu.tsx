import { useTranslation } from 'react-i18next';

import {
  CONTEXT_MENU_ICON_SIZE,
  ContextMenu,
  type ContextMenuAnchor,
  type ContextMenuItem,
} from '@/components/common/ContextMenu';
import { actionMenuHeight } from '@/components/common/ActionMenuPanel';
import { spacing, useThemeColors } from '@/theme';

import {
  ATTACHMENT_OPTIONS,
  type AttachmentSource,
} from './AttachmentPanel';

type Props = {
  anchor: ContextMenuAnchor;
  sources: readonly AttachmentSource[];
  onPick: (source: AttachmentSource) => void;
  onClose: () => void;
};

/** Electron composer attachment actions in the shared pointer-menu chrome. */
export function ComposerAttachmentMenu({ anchor, sources, onPick, onClose }: Props) {
  const { t } = useTranslation();
  const c = useThemeColors();
  const items: ContextMenuItem[] = ATTACHMENT_OPTIONS.filter((option) =>
    sources.includes(option.key),
  ).map((option) => {
    const Icon = option.icon;
    return {
      key: option.key,
      title: t(option.labelKey),
      icon: <Icon size={CONTEXT_MENU_ICON_SIZE.pointer} color={c.text} />,
      onPress: () => onPick(option.key),
    };
  });
  // The trigger sits `spacing.sm` inside the composer row. A `spacing.xs`
  // anchor gap puts the card on the same visual baseline as the emoji picker,
  // whose smaller trigger is inset by one additional `spacing.xs`.
  const menuTop = anchor.y - actionMenuHeight(items, 'pointer') - spacing.xs;

  return (
    <ContextMenu
      anchor={{ x: anchor.x, y: menuTop }}
      density="pointer"
      items={items}
      onClose={onClose}
    />
  );
}
