import { memo } from 'react';
import type { GridApp } from '@/services/explore/model';
import type { RecentAppActions } from './NappletRecentTile';
import { ApplicationContextRow } from './ApplicationContextRow';

type Props<T extends GridApp> = Omit<RecentAppActions<T>, 'onOpen'> & { app: T; testID: string };
function RecentRow<T extends GridApp>({ app, onAdd, onUnfavorite, ...actions }: Props<T>) {
  const favorite = app.desktopPosition !== null;
  return <ApplicationContextRow {...actions} app={app} favorite={favorite}
    onFavorite={favorite ? onUnfavorite : onAdd} />;
}
export const NappletRecentRow = memo(RecentRow) as typeof RecentRow;
