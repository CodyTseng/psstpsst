import * as Sharing from 'expo-sharing';

import type { SharingPort } from '../ports/sharing';

/** OS share sheet backed by `expo-sharing`. */
export const sharingAdapter: SharingPort = {
  isAvailable: () => Sharing.isAvailableAsync(),

  share: (uri, options) =>
    Sharing.shareAsync(uri, {
      mimeType: options?.mimeType,
      dialogTitle: options?.dialogTitle,
      UTI: options?.uti,
    }),
};
