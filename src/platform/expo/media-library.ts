// The classic save API. The package's main entry now deprecates `saveToLibraryAsync`
// in favour of a new class-based API (`Asset.create`), but that needs the native
// "Next" module present in the build; the `/legacy` entry keeps the proven calls
// and silences the deprecation warning.
// See https://docs.expo.dev/versions/v57.0.0/sdk/media-library/
import * as MediaLibrary from 'expo-media-library/legacy';

import type { MediaLibraryPort } from '../ports/media-library';

/** Photo/video library saves backed by `expo-media-library`. */
export const mediaLibraryAdapter: MediaLibraryPort = {
  async requestWritePermission() {
    const permission = await MediaLibrary.requestPermissionsAsync(true);
    return permission.granted;
  },

  async saveToLibrary(uri) {
    await MediaLibrary.saveToLibraryAsync(uri);
    return true;
  },
};
