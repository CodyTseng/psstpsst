import Plus from 'lucide-react-native/icons/plus';
import Trash from 'lucide-react-native/icons/trash-2';
import Info from 'lucide-react-native/icons/info';
import { Share } from '@solar-icons/react-native/category/ui/Linear/Share';
import { ShieldCheck } from '@solar-icons/react-native/category/security/Linear/ShieldCheck';
import { useTranslation } from 'react-i18next';
import { ContextMenu, CONTEXT_MENU_ICON_SIZE, type ContextMenuAnchor, type ContextMenuPlacement } from '@/components/common/ContextMenu';
import { IS_ELECTRON } from '@/lib/platform';
import type { NappletInstallation } from '@/services/napplet/protocol';
import { useThemeColors } from '@/theme';
import { iconStrokeWidth } from '@/theme/icons';

type Props = {
  app: NappletInstallation;
  anchor: ContextMenuAnchor;
  inline?: boolean;
  onClose: () => void;
  onPlacementChange: (placement: ContextMenuPlacement) => void;
  onDetails: (app: NappletInstallation) => void;
  onPermissions: (app: NappletInstallation) => void;
  onShare: (app: NappletInstallation) => void;
  onAdd?: (app: NappletInstallation) => void;
  onRemove?: (app: NappletInstallation) => void;
};

/** Desktop shortcuts and recent apps use the same platform menu vocabulary. */
export function NappletAppMenu({ app, anchor, inline, onClose, onPlacementChange, onDetails, onPermissions, onShare, onAdd, onRemove }: Props) {
  const { t } = useTranslation();
  const c = useThemeColors();
  const density = IS_ELECTRON ? 'pointer' : 'touch';
  const size = CONTEXT_MENU_ICON_SIZE[density];
  return <ContextMenu inline={inline} anchor={anchor} align="center" placement="auto" density={density}
    onClose={onClose} onPlacementChange={onPlacementChange} items={[
      { key: 'details', title: t('napplets.details'), icon: <Info size={size} strokeWidth={iconStrokeWidth.default} color={c.text} />, onPress: () => onDetails(app) },
      { key: 'permissions', title: t('napplets.permissions_manage'), icon: <ShieldCheck size={size} color={c.text} />, onPress: () => onPermissions(app) },
      { key: 'share', title: t('share.title'), icon: <Share size={size} color={c.text} />, onPress: () => onShare(app) },
      ...(onAdd ? [{ key: 'add', title: t('napplets.add_to_desktop'), icon: <Plus size={size} strokeWidth={iconStrokeWidth.default} color={c.text} />, onPress: () => onAdd(app) }] : []),
      ...(onRemove ? [{ key: 'remove', title: t('common.remove'), tone: 'danger' as const, separatorBefore: true,
        icon: <Trash size={size} strokeWidth={iconStrokeWidth.default} color={c.danger} />, onPress: () => onRemove(app) }] : []),
    ]} />;
}
