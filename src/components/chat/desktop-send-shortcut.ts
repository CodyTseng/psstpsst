type Input = {
  key?: string;
  metaKey?: boolean;
  ctrlKey?: boolean;
  shiftKey?: boolean;
  altKey?: boolean;
  isComposing?: boolean;
  repeat?: boolean;
  platform?: string;
  enterToSend?: boolean;
};

type DesktopKeyData = {
  key?: string;
  metaKey?: boolean;
  ctrlKey?: boolean;
  shiftKey?: boolean;
  altKey?: boolean;
  isComposing?: boolean;
  repeat?: boolean;
  keyCode?: number;
};

/** Keyboard fields React Native Web may place on either event level. */
export type DesktopTextInputKeyEvent = DesktopKeyData & {
  nativeEvent: DesktopKeyData;
};

/** Resolve desktop Enter behavior without interfering with native newlines. */
export function shouldSendOnDesktopKeyPress({
  key,
  metaKey = false,
  ctrlKey = false,
  shiftKey = false,
  altKey = false,
  isComposing = false,
  repeat = false,
  platform,
  enterToSend = false,
}: Input): boolean {
  if (key !== 'Enter' || shiftKey || altKey || isComposing || repeat) {
    return false;
  }

  const isPlatformShortcut =
    platform === 'darwin'
      ? metaKey && !ctrlKey
      : ctrlKey && !metaKey;
  if (isPlatformShortcut) return true;

  return enterToSend && !metaKey && !ctrlKey;
}
