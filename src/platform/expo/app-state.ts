import { AppState } from 'react-native';

import type { AppStatePort } from '../ports/app-state';

/** App lifecycle state backed by React Native's `AppState`. */
export const appStateAdapter: AppStatePort = {
  currentState: () => AppState.currentState,

  addChangeListener(listener) {
    const subscription = AppState.addEventListener('change', listener);
    return () => subscription.remove();
  },
};
