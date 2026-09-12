import * as Clipboard from 'expo-clipboard';

/** Thin safe wrapper over `expo-clipboard`, same rationale as `haptics.ts`:
 * a dev client that wasn't rebuilt after the native module was added throws
 * synchronously or rejects on every call. Copy/paste is a nicety — never
 * crash for it. */

/** Copy text to the system clipboard. */
export async function setStringAsync(text: string): Promise<void> {
  try {
    await Clipboard.setStringAsync(text);
  } catch {
    // Native module not linked in this build — ignore until the next rebuild.
  }
}

/** Read the current clipboard text; resolves to '' when unavailable. */
export async function getStringAsync(): Promise<string> {
  try {
    return await Clipboard.getStringAsync();
  } catch {
    // Native module not linked in this build — ignore until the next rebuild.
    return '';
  }
}
