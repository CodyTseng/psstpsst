import { DESKTOP_OS } from '@/lib/platform';

type SearchShortcutEvent = {
  key: string;
  metaKey?: boolean;
  ctrlKey?: boolean;
  altKey?: boolean;
  shiftKey?: boolean;
};

export function isSearchActivationShortcut(
  event: SearchShortcutEvent,
  desktopOS: string | undefined = DESKTOP_OS,
): boolean {
  if (event.key.toLowerCase() !== 'k' || event.altKey || event.shiftKey) return false;
  return desktopOS === 'darwin'
    ? event.metaKey === true && event.ctrlKey !== true
    : event.ctrlKey === true && event.metaKey !== true;
}

export function getSearchActivationShortcutLabel(
  desktopOS: string | undefined = DESKTOP_OS,
): string | undefined {
  if (!desktopOS) return undefined;
  return desktopOS === 'darwin' ? '⌘K' : 'Ctrl+K';
}

export const SEARCH_ACTIVATION_SHORTCUT_LABEL = getSearchActivationShortcutLabel();

export function resolveSearchPlaceholder(
  placeholder: string,
  shortcutHint: string | undefined,
  focused: boolean,
): string {
  return shortcutHint && !focused
    ? `${placeholder} (${shortcutHint})`
    : placeholder;
}
