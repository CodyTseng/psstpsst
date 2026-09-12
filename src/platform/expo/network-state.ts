import * as Network from 'expo-network';

import type { NetworkStatePort } from '../ports/network-state';

/** Network-reachability hint backed by `expo-network`. */
export const networkStateAdapter: NetworkStatePort = {
  getState: () => Network.getNetworkStateAsync(),

  addStateListener(listener) {
    Network.addNetworkStateListener(listener);
  },
};
