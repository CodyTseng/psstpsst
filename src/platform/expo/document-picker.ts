import * as DocumentPicker from 'expo-document-picker';

import type { DocumentPickerPort } from '../ports/document-picker';

/** System document picker backed by `expo-document-picker`. */
export const documentPickerAdapter: DocumentPickerPort = {
  async pickDocument(options) {
    const result = await DocumentPicker.getDocumentAsync({
      type: options.type,
      copyToCacheDirectory: true,
    });
    const asset = result.canceled ? undefined : result.assets?.[0];
    return asset ? { uri: asset.uri, name: asset.name } : null;
  },
};
