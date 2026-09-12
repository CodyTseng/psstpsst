import { Children, type ReactNode } from 'react';
import { StyleSheet, type StyleProp, View, type ViewStyle } from 'react-native';

import { radius, useThemeColors } from '@/theme';

import { ListGroupContext } from './list-group-context';
import { ROW_CONTENT_INSET } from './ListRow';

type Props = {
  /** A list of `ListRow`s. */
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
};

/**
 * Groups related rows into one iOS-style card: a single rounded `surfaceElevated`
 * panel with hairline separators between rows (the rows render embedded, see
 * {@link ListGroupContext}). A `SectionLabel` heading above it is optional and
 * usually skipped — stacked groups read fine separated by spacing alone
 * (DESIGN §8). For a lone row, a standalone `ListRow variant="card"` still works.
 */
export function ListGroup({ children, style }: Props) {
  const c = useThemeColors();
  const rows = Children.toArray(children).filter(Boolean);

  return (
    <ListGroupContext.Provider value={true}>
      <View
        style={[
          {
            borderRadius: radius.lg,
            backgroundColor: c.surfaceElevated,
            overflow: 'hidden',
          },
          style,
        ]}
      >
        {rows.map((row, i) => (
          <View key={i}>
            {i > 0 ? (
              <View
                style={{
                  height: StyleSheet.hairlineWidth,
                  backgroundColor: c.border,
                  marginStart: ROW_CONTENT_INSET,
                }}
              />
            ) : null}
            {row}
          </View>
        ))}
      </View>
    </ListGroupContext.Provider>
  );
}
