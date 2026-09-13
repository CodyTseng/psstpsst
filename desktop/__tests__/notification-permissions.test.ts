import { DesktopNotificationPermissions } from '../notification-permissions';

function setup(platform: NodeJS.Platform = 'darwin') {
  const native = {
    hasPermission: jest.fn(async () => false),
    requestPermission: jest.fn(async () => false),
  };
  const options = {
    platform,
    isSupported: jest.fn(() => true),
    loadMacPermissions: jest.fn(() => native),
    openExternal: jest.fn(async (_url: string) => {}),
  };
  return { native, options, permissions: new DesktopNotificationPermissions(options) };
}

it('does not initialize Electron notifications or prompt during a macOS capability probe', () => {
  const { permissions, options } = setup();
  expect(permissions.isSupported()).toBe(true);
  expect(options.isSupported).not.toHaveBeenCalled();
  expect(options.loadMacPermissions).not.toHaveBeenCalled();
});

it('reports the current OS grant rather than the supported capability', async () => {
  const { permissions, native, options } = setup();
  await expect(permissions.hasPermission()).resolves.toBe(false);
  native.hasPermission.mockResolvedValue(true);
  await expect(permissions.hasPermission()).resolves.toBe(true);
  native.hasPermission.mockResolvedValue(false);
  await expect(permissions.hasPermission()).resolves.toBe(false);
  expect(native.requestPermission).not.toHaveBeenCalled();
  expect(options.loadMacPermissions).toHaveBeenCalledTimes(1);
});

it('coalesces concurrent permission requests and returns the actual decision', async () => {
  const { permissions, native } = setup();
  let complete!: (granted: boolean) => void;
  native.requestPermission.mockImplementation(() => new Promise(resolve => { complete = resolve; }));
  const first = permissions.ensurePermission();
  const second = permissions.ensurePermission();
  expect(first).toBe(second);
  complete(false);
  await expect(first).resolves.toBe(false);
  expect(native.requestPermission).toHaveBeenCalledTimes(1);
  native.requestPermission.mockResolvedValue(true);
  await expect(permissions.ensurePermission()).resolves.toBe(true);
});

it('does not turn a broken native bridge into a granted permission', async () => {
  const { permissions, options } = setup();
  options.loadMacPermissions.mockImplementation(() => { throw new Error('Missing native bridge'); });
  await expect(permissions.hasPermission()).rejects.toThrow('Missing native bridge');
  await expect(permissions.ensurePermission()).rejects.toThrow('Missing native bridge');
});

it('opens only the fixed macOS notification settings page', async () => {
  const { permissions, options } = setup();
  await expect(permissions.openSettings()).resolves.toBe(true);
  expect(options.openExternal).toHaveBeenCalledWith(
    'x-apple.systempreferences:com.apple.Notifications-Settings.extension',
  );
});

it.each(['win32', 'linux'] as const)('preserves %s capability behavior without loading macOS code', async platform => {
  const { permissions, options } = setup(platform);
  await expect(permissions.hasPermission()).resolves.toBe(true);
  await expect(permissions.ensurePermission()).resolves.toBe(true);
  await expect(permissions.openSettings()).resolves.toBe(false);
  expect(options.loadMacPermissions).not.toHaveBeenCalled();
  options.isSupported.mockReturnValue(false);
  await expect(permissions.hasPermission()).resolves.toBe(false);
});
