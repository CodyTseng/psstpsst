import { createContext, type ReactNode, useContext } from 'react';
import { StatusBar, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useEffectiveColorScheme, useThemeColors } from '@/theme';

type Props = {
  children: ReactNode;
  /** Vertical safe-area edges. Horizontal safe areas are always applied so
   * ordinary screens stay clear of landscape notches and rounded corners. */
  edges?: readonly ('top' | 'bottom')[];
};

type HorizontalEdge = 'left' | 'right';

const HorizontalSafeAreaEdgesContext = createContext<readonly HorizontalEdge[]>([
  'left',
  'right',
]);

/** Masks physical-window safe areas at pane boundaries: a primary pane owns
 * only the outer start edge, while its detail pane owns the outer end edge. */
export function AppScreenHorizontalSafeArea({
  children,
  edges,
}: {
  children: ReactNode;
  edges: readonly HorizontalEdge[];
}) {
  return (
    <HorizontalSafeAreaEdgesContext.Provider value={edges}>
      {children}
    </HorizontalSafeAreaEdgesContext.Provider>
  );
}

/** Screen-level container that paints the themed background edge-to-edge. */
export function AppScreen({ children, edges = ['top', 'bottom'] }: Props) {
  const c = useThemeColors();
  const scheme = useEffectiveColorScheme();
  const horizontalEdges = useContext(HorizontalSafeAreaEdgesContext);
  return (
    <View style={{ flex: 1, backgroundColor: c.background }}>
      <StatusBar
        barStyle={scheme === 'dark' ? 'light-content' : 'dark-content'}
        translucent
        backgroundColor="transparent"
      />
      <SafeAreaView style={{ flex: 1 }} edges={[...horizontalEdges, ...edges]}>
        {children}
      </SafeAreaView>
    </View>
  );
}
