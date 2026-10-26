import { Linking } from 'react-native';
import { requireOptionalNativeModule } from 'expo-modules-core';

import type { UrlOpenerPort } from '../ports/url-opener';

/** External URL opening backed by React Native's `Linking`. */
export const urlOpenerAdapter: UrlOpenerPort = {
  async openApprovedBrowserUrl(url) {
    const native = requireOptionalNativeModule<{ openBrowserExternalAsync?(url: string): Promise<boolean> }>('ExpoNapplet');
    try { return native?.openBrowserExternalAsync ? await native.openBrowserExternalAsync(url) : await Linking.openURL(url).then(() => true); }
    catch { return false; }
  },
  openExternalUrl: (url) => Linking.openURL(url).then(() => true, () => false),
};
