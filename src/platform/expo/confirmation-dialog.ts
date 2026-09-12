import { Alert, Platform } from 'react-native';

import type { ConfirmationDialogPort } from '../ports/confirmation-dialog';

/** Native Alert on mobile, with the browser's modal dialogs on web. */
export const confirmationDialogAdapter: ConfirmationDialogPort = {
  confirm(options) {
    if (Platform.OS === 'web') {
      return Promise.resolve(globalThis.confirm(`${options.title}\n\n${options.message}`));
    }

    return new Promise((resolve) => {
      Alert.alert(
        options.title,
        options.message,
        [
          { text: options.cancelLabel, style: 'cancel', onPress: () => resolve(false) },
          {
            text: options.confirmLabel,
            style: options.destructive ? 'destructive' : 'default',
            isPreferred: !options.destructive,
            onPress: () => resolve(true),
          },
        ],
        { cancelable: true, onDismiss: () => resolve(false) },
      );
    });
  },
  notify(options) {
    if (Platform.OS === 'web') {
      globalThis.alert(
        options.message ? `${options.title}\n\n${options.message}` : options.title,
      );
      return Promise.resolve();
    }

    return new Promise((resolve) => {
      Alert.alert(options.title, options.message, [
        { text: options.okLabel, isPreferred: true, onPress: () => resolve() },
      ]);
    });
  },
};
