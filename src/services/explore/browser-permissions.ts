import type { TFunction } from 'i18next';

const labels: Record<string, string> = {
  media: 'browser_camera_microphone', video: 'browser_camera', audio: 'browser_microphone',
  geolocation: 'browser_location', notifications: 'browser_notifications', fullscreen: 'browser_fullscreen',
  'clipboard-read': 'browser_clipboard_read',
  midi: 'browser_midi', midiSysex: 'browser_midi', pointerLock: 'browser_pointer_lock',
  'display-capture': 'browser_screen_capture', mediaKeySystem: 'browser_protected_media',
};

/** Preserve unrecognized resource names so an approval never hides the requested scope. */
export function browserPermissionLabel(resource: string, t: TFunction): string {
  return Object.hasOwn(labels, resource) ? t(`napplets.${labels[resource]}`) : `${t('napplets.browser_permission')}: ${resource}`;
}

/** Automatic capabilities do not expose private data or grant device access. */
export function automaticBrowserPermission(resource: string): boolean {
  return ['persistent-storage', 'clipboard-write', 'clipboard-sanitized-write'].includes(resource);
}
/** Capture selectors and unknown capabilities always require a fresh decision. */
export function rememberBrowserPermission(resources: readonly string[]): boolean {
  return resources.length > 0 && resources.every(resource => Object.hasOwn(labels, resource) && resource !== 'display-capture');
}
