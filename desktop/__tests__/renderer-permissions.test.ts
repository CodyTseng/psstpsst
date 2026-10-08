import { isAllowedRendererPermission } from '../renderer-permissions';

it.each(['media', 'notifications', 'fullscreen'])('allows %s for a trusted renderer', (permission) => {
  expect(isAllowedRendererPermission(permission)).toBe(true);
});

it.each(['automatic-fullscreen', 'display-capture', 'geolocation', 'clipboard-read', 'unknown'])(
  'does not grant %s as a side effect of enabling video fullscreen', (permission) => {
    expect(isAllowedRendererPermission(permission)).toBe(false);
  },
);
