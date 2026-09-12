import * as LocalAuthentication from 'expo-local-authentication';

import type { LocalAuthPort } from '../ports/local-auth';

/** On-device authentication backed by `expo-local-authentication`. */
export const localAuthAdapter: LocalAuthPort = {
  async hasEnrolledAuth() {
    const level = await LocalAuthentication.getEnrolledLevelAsync();
    return level !== LocalAuthentication.SecurityLevel.NONE;
  },

  async authenticate(options) {
    const result = await LocalAuthentication.authenticateAsync({
      promptMessage: options.promptMessage,
      cancelLabel: options.cancelLabel,
      disableDeviceFallback: false,
    });
    return result.success;
  },
};
