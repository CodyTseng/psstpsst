import { useRef, useState } from 'react';
import { View } from 'react-native';
import { useTranslation } from 'react-i18next';
import type { ContextMenuAnchor, ContextMenuPlacement } from '@/components/common/ContextMenu';
import { IS_ELECTRON, type DesktopContextMenuEvent } from '@/lib/platform';
import { impact } from '@/lib/haptics';
import type { GridApp } from '@/services/explore/model';
import { spacing } from '@/theme';
import { NappletAppMenu } from './NappletAppMenu';
import { NappletTile } from './NappletTile';

export type RecentAppActions<T extends GridApp = GridApp> = {
  onOpen: (app: T) => void;
  onAdd: (app: T) => void;
  onUnfavorite: (app: T) => void;
  onRemove: (app: T) => void;
  onDetails: (app: T) => void;
  onPermissions: (app: T) => void;
  onShare: (app: T) => void;
};

type Props<T extends GridApp = GridApp> = RecentAppActions<T> & {
  app: T;
  width: number;
  height: number;
  iconSize: number;
  testID: string;
};

/** Recent history owns its menu and never participates in desktop drag state. */
export function NappletRecentTile<T extends GridApp>({ app, width, height, iconSize, testID, onOpen, onAdd, onUnfavorite, onRemove, onDetails, onPermissions, onShare }: Props<T>) {
  const { t } = useTranslation();
  const icon = useRef<View>(null);
  const [anchor, setAnchor] = useState<ContextMenuAnchor | null>(null);
  const [menuPlacement, setMenuPlacement] = useState<ContextMenuPlacement>('above');
  function showMenu(feedback: boolean) {
    icon.current?.measureInWindow((x, y, width, height) => {
      if (feedback && !IS_ELECTRON) impact('light');
      setMenuPlacement('above');
      setAnchor({ x, y, width, height });
    });
  }
  return <View testID={testID}
    style={{ width, height, paddingVertical: spacing.sm }}
    {...(IS_ELECTRON ? { onContextMenu: (event: DesktopContextMenuEvent) => {
      event.preventDefault?.(); event.stopPropagation?.();
      showMenu(false);
    } } : {})}>
    <NappletTile app={app} iconSize={iconSize} iconRef={icon} hideLabel={anchor !== null && menuPlacement === 'below'} onPress={() => onOpen(app)}
      onLongPress={() => showMenu(true)}
      accessibilityActions={[
        { name: 'details', label: t('napplets.details') },
        { name: 'permissions', label: t('napplets.permissions_manage') },
        ...(!app.local ? [{ name: 'share', label: t('share.title') }] : []),
        ...(app.desktopPosition === null ? [
          { name: 'add', label: t('napplets.add_app') },
        ] : []),
        ...(app.desktopPosition !== null ? [{ name: 'unfavorite', label: t('napplets.remove_app') }] : []),
        { name: 'remove', label: t('napplets.remove_from_history') },
      ]}
      onAccessibilityAction={(event) => {
        if (event.nativeEvent.actionName === 'details') onDetails(app);
        else if (event.nativeEvent.actionName === 'permissions') onPermissions(app);
        else if (event.nativeEvent.actionName === 'share' && !app.local) onShare(app);
        else if (event.nativeEvent.actionName === 'add' && app.desktopPosition === null) onAdd(app);
        else if (event.nativeEvent.actionName === 'unfavorite') onUnfavorite(app);
        else if (event.nativeEvent.actionName === 'remove') onRemove(app);
      }} />
    {anchor ? <NappletAppMenu app={app} anchor={anchor} onClose={() => setAnchor(null)}
      onPlacementChange={setMenuPlacement} onDetails={onDetails} onPermissions={onPermissions} onShare={onShare}
      favorite={app.desktopPosition !== null} onFavorite={app.desktopPosition === null ? onAdd : onUnfavorite} onRemove={onRemove} /> : null}
  </View>;
}
