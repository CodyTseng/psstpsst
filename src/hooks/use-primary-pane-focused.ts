import { useIsFocused, useNavigation, useRoute } from 'expo-router';
import { useCallback, useSyncExternalStore } from 'react';

import { usePrimaryPaneNavigation } from '@/components/navigation/primary-pane-navigation';

/** Visible primary tabs remain interactive while the stack focuses a detail. */
export function usePrimaryPaneFocused(): boolean {
  const focused = useIsFocused();
  const navigation = useNavigation();
  const route = useRoute();
  const { wide } = usePrimaryPaneNavigation();
  const subscribe = useCallback((listener: () => void) => {
    if (!wide) return () => {};
    return navigation.addListener('state', listener);
  }, [navigation, wide]);
  const getSelected = useCallback(() => {
    if (!wide) return false;
    const state = navigation.getState();
    return state != null && state.routes[state.index]?.key === route.key;
  }, [navigation, route.key, wide]);
  const selected = useSyncExternalStore(subscribe, getSelected, getSelected);
  return wide ? selected : focused;
}
