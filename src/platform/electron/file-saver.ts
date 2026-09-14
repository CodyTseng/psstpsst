import type { FileSaverPort } from '../ports/file-saver';
import { getElectronBridge } from './bridge';

/** Desktop file export backed by the native Save As dialog. */
export const electronFileSaverAdapter: FileSaverPort = {
  save: (uri, options) =>
    getElectronBridge().dialogs.saveFile(uri, options.suggestedName),
};
