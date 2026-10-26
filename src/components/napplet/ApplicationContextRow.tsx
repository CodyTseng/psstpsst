import { memo, useMemo, useState } from 'react';
import { Platform, View, type GestureResponderEvent } from 'react-native';
import { useTranslation } from 'react-i18next';
import type { ContextMenuAnchor } from '@/components/common/ContextMenu';
import { IS_ELECTRON, desktopContextMenuPoint, type DesktopContextMenuEvent } from '@/lib/platform';
import { impact } from '@/lib/haptics';
import type { ExploreEntry, GridApp } from '@/services/explore/model';
import { NappletAppMenu } from './NappletAppMenu';

import { ApplicationListRow } from './ApplicationListRow';

type MenuApplication = GridApp & Partial<Pick<ExploreEntry, 'kind' | 'description' | 'release'>>;
type Props<T extends MenuApplication> = {
  app: T; favorite: boolean; testID?: string;
  onFavorite(app: T): void;
  onRemove?: (app: T) => void;
  onDetails(app: T): void;
  onPermissions(app: T): void;
  onShare(app: T): void;
};

/** Catalogue and history rows share pointer-anchored menus without grid drag state. */
function ContextRow<T extends MenuApplication>({ app, favorite, testID, onFavorite, onRemove, onDetails, onPermissions, onShare }: Props<T>) {
  const { t } = useTranslation();
  const [anchor, setAnchor] = useState<ContextMenuAnchor | null>(null);
  const application = useMemo(() => ({ ...app, kind: app.kind ?? 'napplet' as const, publisher: app.manifest?.pubkey ?? app.release?.event.pubkey }), [app]);
  function showMenu(event: GestureResponderEvent) {
    const { pageX, pageY } = event.nativeEvent;
    if (!IS_ELECTRON) impact('light');
    setAnchor({ x: pageX, y: pageY });
  }
  return <View testID={testID}
    {...(Platform.OS === 'web' ? { onContextMenu: (event: DesktopContextMenuEvent) => {
      event.preventDefault?.(); event.stopPropagation?.();
      const point = desktopContextMenuPoint(event);
      if (point) setAnchor(point);
    } } : {})}>
    <ApplicationListRow application={application} onPress={() => onDetails(app)}
      onLongPress={showMenu}
      accessibilityActions={[
        { name: 'details', label: t('napplets.details') },
        { name: 'permissions', label: t('napplets.permissions_manage') },
        { name: 'share', label: t('share.title') },
        { name: 'favorite', label: t(favorite ? 'napplets.remove_from_desktop' : 'napplets.add_to_desktop') },
        ...(onRemove ? [{ name: 'remove', label: t('common.remove') }] : []),
      ]}
      onAccessibilityAction={(event) => {
        if (event.nativeEvent.actionName === 'details') onDetails(app);
        else if (event.nativeEvent.actionName === 'permissions') onPermissions(app);
        else if (event.nativeEvent.actionName === 'share') onShare(app);
        else if (event.nativeEvent.actionName === 'favorite') onFavorite(app);
        else if (event.nativeEvent.actionName === 'remove') onRemove?.(app);
      }} />
    {anchor ? <NappletAppMenu app={app} anchor={anchor} point favorite={favorite} onFavorite={onFavorite} onClose={() => setAnchor(null)}
      onDetails={onDetails} onPermissions={onPermissions} onShare={onShare}
      onRemove={onRemove} /> : null}
  </View>;
}

export const ApplicationContextRow = memo(ContextRow) as typeof ContextRow;
