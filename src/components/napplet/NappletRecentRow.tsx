import { memo, useMemo } from 'react';
import type { GridApp } from '@/services/explore/model';
import type { RecentAppActions } from './NappletRecentTile';
import { ApplicationContextRow } from './ApplicationContextRow';

type Props<T extends GridApp> = Omit<RecentAppActions<T>, 'onOpen'> & { app: T; testID: string; desktopPosition?: number | null };
function RecentRow<T extends GridApp>({ app, desktopPosition, onAdd, onUnfavorite, ...actions }: Props<T>) {
  const entry = useMemo(() => desktopPosition === undefined || desktopPosition === app.desktopPosition ? app : { ...app, desktopPosition }, [app, desktopPosition]);
  const favorite = entry.desktopPosition !== null;
  return <ApplicationContextRow {...actions} app={entry} favorite={favorite}
    onFavorite={favorite ? onUnfavorite : onAdd} />;
}
export const NappletRecentRow = memo(RecentRow) as typeof RecentRow;
