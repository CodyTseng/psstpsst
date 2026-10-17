import { useRef, useState } from 'react';
import { View } from 'react-native';
import { useTranslation } from 'react-i18next';
import type { ContextMenuAnchor, ContextMenuPlacement } from '@/components/common/ContextMenu';
import { IS_ELECTRON, type DesktopContextMenuEvent } from '@/lib/platform';
import { impact } from '@/lib/haptics';
import type { NappletInstallation } from '@/services/napplet/protocol';
import { spacing } from '@/theme';
import { NappletAppMenu } from './NappletAppMenu';
import { NappletTile } from './NappletTile';

export type RecentAppActions = {
  onOpen: (app: NappletInstallation) => void;
  onAdd: (app: NappletInstallation) => void;
  onRemove: (app: NappletInstallation) => void;
  onDetails: (app: NappletInstallation) => void;
  onPermissions: (app: NappletInstallation) => void;
  onShare: (app: NappletInstallation) => void;
};

type Props = RecentAppActions & {
  app: NappletInstallation;
  width: number;
  height: number;
  iconSize: number;
  testID: string;
};

/** Recent history owns its menu and never participates in desktop drag state. */
export function NappletRecentTile({ app, width, height, iconSize, testID, onOpen, onAdd, onRemove, onDetails, onPermissions, onShare }: Props) {
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
        { name: 'share', label: t('share.title') },
        ...(app.desktopPosition === null ? [
          { name: 'add', label: t('napplets.add_to_desktop') },
          { name: 'remove', label: t('common.remove') },
        ] : []),
      ]}
      onAccessibilityAction={(event) => {
        if (event.nativeEvent.actionName === 'details') onDetails(app);
        else if (event.nativeEvent.actionName === 'permissions') onPermissions(app);
        else if (event.nativeEvent.actionName === 'share') onShare(app);
        else if (event.nativeEvent.actionName === 'add' && app.desktopPosition === null) onAdd(app);
        else if (event.nativeEvent.actionName === 'remove' && app.desktopPosition === null) onRemove(app);
      }} />
    {anchor ? <NappletAppMenu app={app} anchor={anchor} onClose={() => setAnchor(null)}
      onPlacementChange={setMenuPlacement} onDetails={onDetails} onPermissions={onPermissions} onShare={onShare}
      onAdd={app.desktopPosition === null ? onAdd : undefined} onRemove={app.desktopPosition === null ? onRemove : undefined} /> : null}
  </View>;
}
