import type { ScreenOrientationPort } from '../ports/screen-orientation';

let pending = Promise.resolve();

/** Serialize rapid page changes so an old cleanup cannot relock a new video. */
export const screenOrientationAdapter: ScreenOrientationPort = {
  setVideoActive(active) {
    const next = pending.then(async () => {
      // Native capabilities load only when this port is used.
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const orientation = require('expo-screen-orientation') as typeof import('expo-screen-orientation');
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const device = require('expo-device') as typeof import('expo-device');
      const type = await device.getDeviceTypeAsync();
      // Tablets already rotate freely; avoid interfering with iPad multitasking.
      if (type !== device.DeviceType.PHONE) return;
      const lock = active
        ? orientation.OrientationLock.DEFAULT
        : orientation.OrientationLock.PORTRAIT_UP;
      await orientation.lockAsync(lock);
    });
    pending = next.catch(() => {});
    return next;
  },
};
