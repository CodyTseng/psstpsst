import { Linking } from 'react-native';

import type { UrlOpenerPort } from '../ports/url-opener';

/** External URL opening backed by React Native's `Linking`. */
export const urlOpenerAdapter: UrlOpenerPort = {
  // Fire-and-forget: callers don't handle failures, so swallow them here.
  openExternalUrl: (url) => Linking.openURL(url).catch(() => {}),
};
