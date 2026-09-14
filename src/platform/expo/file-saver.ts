import { Directory, File } from 'expo-file-system';

import type { FileSaverPort } from '../ports/file-saver';

/** Mobile file export backed by the system directory picker and native copy. */
export const fileSaverAdapter: FileSaverPort = {
  async save(uri, options) {
    try {
      const destinationDirectory = await Directory.pickDirectoryAsync();
      const name =
        options.suggestedName
          .replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_')
          .slice(0, 120) || 'psstpsst-file';
      const destination = destinationDirectory.createFile(
        name,
        options.mimeType ?? 'application/octet-stream',
      );
      await new File(uri).copy(destination);
      return true;
    } catch {
      // The native directory picker rejects when it is dismissed.
      return false;
    }
  },
};
