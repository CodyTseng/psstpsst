import type { DeepLinkPort } from '../ports/deep-link';

/** Expo Router owns cold and warm links on native and ordinary web runtimes. */
export const deepLinkAdapter: DeepLinkPort = {
  takePendingUrl: () => Promise.resolve(null),
  addListener: () => () => {},
};
