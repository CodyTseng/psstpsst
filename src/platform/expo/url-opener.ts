import { Linking } from 'react-native';

import type { UrlOpenerPort } from '../ports/url-opener';

/** External URL opening backed by React Native's `Linking`. */
export const urlOpenerAdapter: UrlOpenerPort = {
  openExternalUrl: (url) => Linking.openURL(url).then(() => true, () => false),
};
