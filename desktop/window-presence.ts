export type WindowPresenceSource = {
  isFocused(): boolean;
  isVisible(): boolean;
};

/** The user is present only while the desktop window is both visible and focused. */
export function isWindowUserPresent(window: WindowPresenceSource): boolean {
  return window.isVisible() && window.isFocused();
}
