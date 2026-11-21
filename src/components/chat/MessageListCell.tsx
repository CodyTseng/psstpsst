import { useContext, useLayoutEffect, useMemo, type ComponentProps } from 'react';
import { View, type FlatListProps } from 'react-native';
import { ImageVisibilityContext, ImageVisibilityStoreContext } from '@/components/common/VisibilityAwareImage';
import { IS_ELECTRON } from '@/lib/platform';
import type { ListItem } from './message-list-data';
import { MessageCellFrameContext } from './message-row-layout';
import { MESSAGE_CELL_DATA_KEY } from './message-scroll-layout';

type Props = ComponentProps<NonNullable<FlatListProps<ListItem>['CellRendererComponent']>>;

/** Preserve FlatList's cell wrapper and layout callbacks, adding only identity
 * for exact Electron geometry reads after rows change their list indices. */
export function MessageListCell({ cellKey, item, children, style, onLayout, onFocusCapture }: Props) {
  const onCellFrame = useContext(MessageCellFrameContext);
  useLayoutEffect(() => () => onCellFrame?.(cellKey, null), [cellKey, onCellFrame]);
  const store = useContext(ImageVisibilityStoreContext);
  const visibility = useMemo(() => store ? { store, key: cellKey } : null, [store, cellKey]);
  const identity = IS_ELECTRON && item.kind === 'message'
    ? { dataSet: { [MESSAGE_CELL_DATA_KEY]: item.message.id } }
    : {};
  return (
    <View
      style={style}
      onLayout={onCellFrame ? (event) => {
        const { y, height } = event.nativeEvent.layout;
        onCellFrame(cellKey, { y, height });
        onLayout?.(event);
      } : onLayout}
      {...{ onFocusCapture }}
      {...identity}
    >
      <ImageVisibilityContext value={visibility}>{children}</ImageVisibilityContext>
    </View>
  );
}
