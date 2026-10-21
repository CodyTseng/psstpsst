import { memo, useMemo, useRef, useState } from 'react';
import { View } from 'react-native';
import { useTranslation } from 'react-i18next';
import type { ContextMenuAnchor } from '@/components/common/ContextMenu';
import { IS_ELECTRON, type DesktopContextMenuEvent } from '@/lib/platform';
import { impact } from '@/lib/haptics';
import type { ExploreEntry, GridApp } from '@/services/explore/model';
import { NappletAppMenu } from './NappletAppMenu';

import type { RecentAppActions } from './NappletRecentTile';
import { ApplicationListRow } from './ApplicationListRow';

const ignorePlacement = () => {};

type RecentApp = GridApp & Partial<Pick<ExploreEntry, 'kind' | 'description' | 'release'>>;
type Props<T extends RecentApp> = Omit<RecentAppActions<T>, 'onOpen'> & { app: T; testID: string };

/** Recent history owns its menu and never participates in desktop drag state. */
function RecentRow<T extends RecentApp>({ app, testID, onAdd, onRemove, onDetails, onPermissions, onShare }: Props<T>) {
  const { t } = useTranslation();
  const icon = useRef<View>(null);
  const [anchor, setAnchor] = useState<ContextMenuAnchor | null>(null);
  const application = useMemo(() => ({ ...app, kind: app.kind ?? 'napplet' as const, publisher: app.manifest?.pubkey ?? app.release?.event.pubkey }), [app]);
  function showMenu(feedback: boolean) {
    icon.current?.measureInWindow((x, y, width, height) => {
      if (feedback && !IS_ELECTRON) impact('light');
      setAnchor({ x, y, width, height });
    });
  }
  return <View testID={testID}
    ref={icon} collapsable={false}
    {...(IS_ELECTRON ? { onContextMenu: (event: DesktopContextMenuEvent) => {
      event.preventDefault?.(); event.stopPropagation?.();
      showMenu(false);
    } } : {})}>
    <ApplicationListRow application={application} onPress={() => onDetails(app)}
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
      onPlacementChange={ignorePlacement} onDetails={onDetails} onPermissions={onPermissions} onShare={onShare}
      onAdd={app.desktopPosition === null ? onAdd : undefined} onRemove={app.desktopPosition === null ? onRemove : undefined} /> : null}
  </View>;
}

export const NappletRecentRow = memo(RecentRow) as typeof RecentRow;
