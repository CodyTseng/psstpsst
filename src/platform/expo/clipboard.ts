import type { ClipboardPort } from '../ports/clipboard';
import { imageManipulatorAdapter } from './image-manipulator';

export const clipboardAdapter: ClipboardPort = {
  async writeText(text) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- optional native capability
    const clipboard = require('expo-clipboard') as typeof import('expo-clipboard');
    await clipboard.setStringAsync(text);
  },
  async readText() {
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- optional native capability
    const clipboard = require('expo-clipboard') as typeof import('expo-clipboard');
    return clipboard.getStringAsync();
  },
  canCopyAttachment: (mime) => !!mime?.startsWith('image/'),
  async copyAttachment(uri, options) {
    if (!options?.mimeType?.startsWith('image/')) throw new Error('File clipboard unavailable');
    // Convert WebP and other attachment encodings to a native clipboard image.
    const image = await imageManipulatorAdapter.renderAndSave(uri, {
      format: 'png', quality: 1, includeBase64: true,
    });
    try {
      if (!image.base64) throw new Error('Clipboard image unavailable');
      // eslint-disable-next-line @typescript-eslint/no-require-imports -- optional native capability
      const clipboard = require('expo-clipboard') as typeof import('expo-clipboard');
      await clipboard.setImageAsync(image.base64);
    } finally {
      // eslint-disable-next-line @typescript-eslint/no-require-imports -- keep filesystem initialization lazy
      const { fileSystemAdapter } = require('./file-system') as typeof import('./file-system');
      await fileSystemAdapter.delete(image.uri, { idempotent: true }).catch(() => {});
    }
  },
};
