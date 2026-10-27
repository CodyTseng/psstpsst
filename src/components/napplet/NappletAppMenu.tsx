import Star from 'lucide-react-native/icons/star';
import Trash from 'lucide-react-native/icons/trash-2';
import Info from 'lucide-react-native/icons/info';
import { Share } from '@solar-icons/react-native/category/ui/Linear/Share';
import { ShieldCheck } from '@solar-icons/react-native/category/security/Linear/ShieldCheck';
import { useTranslation } from 'react-i18next';
import { ContextMenu, CONTEXT_MENU_ICON_SIZE, type ContextMenuAnchor, type ContextMenuPlacement } from '@/components/common/ContextMenu';
import { IS_ELECTRON } from '@/lib/platform';
import type { GridApp } from '@/services/explore/model';
import { useThemeColors } from '@/theme';
import { iconStrokeWidth } from '@/theme/icons';

type Props<T extends GridApp> = {
  app: T;
  anchor: ContextMenuAnchor;
  inline?: boolean;
  point?: boolean;
  favorite?: boolean;
  onClose: () => void;
  onPlacementChange?: (placement: ContextMenuPlacement) => void;
  onDetails: (app: T) => void;
  onPermissions: (app: T) => void;
  onShare: (app: T) => void;
  onFavorite?: (app: T) => void;
  onRemove?: (app: T) => void;
};

/** Desktop shortcuts and recent apps use the same platform menu vocabulary. */
export function NappletAppMenu<T extends GridApp>({ app, anchor, inline, point, favorite = false, onClose, onPlacementChange, onDetails, onPermissions, onShare, onFavorite, onRemove }: Props<T>) {
  const { t } = useTranslation();
  const c = useThemeColors();
  const density = IS_ELECTRON ? 'pointer' : 'touch';
  const size = CONTEXT_MENU_ICON_SIZE[density];
  return <ContextMenu inline={inline} anchor={anchor} align={point ? 'start' : 'center'} placement="auto" density={density}
    onClose={onClose} onPlacementChange={onPlacementChange} items={[
      { key: 'details', title: t('napplets.details'), icon: <Info size={size} strokeWidth={iconStrokeWidth.default} color={c.text} />, onPress: () => onDetails(app) },
      { key: 'permissions', title: t('napplets.permissions_manage'), icon: <ShieldCheck size={size} color={c.text} />, onPress: () => onPermissions(app) },
      ...(!app.local ? [{ key: 'share', title: t('share.title'), icon: <Share size={size} color={c.text} />, onPress: () => onShare(app) }] : []),
      ...(onFavorite ? [{ key: 'favorite', title: t(favorite ? 'napplets.remove_from_desktop' : 'napplets.add_to_desktop'), icon: <Star size={size} strokeWidth={iconStrokeWidth.default} color={c.text} />, onPress: () => onFavorite(app) }] : []),
      ...(onRemove ? [{ key: 'remove', title: t('common.remove'), tone: 'danger' as const, separatorBefore: true,
        icon: <Trash size={size} strokeWidth={iconStrokeWidth.default} color={c.danger} />, onPress: () => onRemove(app) }] : []),
    ]} />;
}
