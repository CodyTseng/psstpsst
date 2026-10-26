import type { ComponentProps } from 'react';
import { View, type FlatListProps } from 'react-native';
import { IS_ELECTRON } from '@/lib/platform';
import type { ListItem } from './message-list-data';
import { MESSAGE_CELL_DATA_KEY } from './message-scroll-layout';

type Props = ComponentProps<NonNullable<FlatListProps<ListItem>['CellRendererComponent']>>;

/** Preserve FlatList's cell wrapper and layout callbacks, adding only identity
 * for exact Electron geometry reads after rows change their list indices. */
export function MessageListCell({ item, children, style, onLayout, onFocusCapture }: Props) {
  const identity = IS_ELECTRON && item.kind === 'message'
    ? { dataSet: { [MESSAGE_CELL_DATA_KEY]: item.message.id } }
    : {};
  return (
    <View style={style} onLayout={onLayout} {...{ onFocusCapture }} {...identity}>
      {children}
    </View>
  );
}
