const { withDangerousMod } = require('expo/config-plugins');
const { generateImageAsync } = require('@expo/image-utils');
const { mkdir, writeFile } = require('node:fs/promises');
const { join } = require('node:path');

/** Preserve the existing monochrome notification icon across Android display densities. */
module.exports = function withLocalNotifications(config, { icon }) {
  return withDangerousMod(config, ['android', async (mod) => {
    const projectRoot = mod.modRequest.projectRoot;
    await Promise.all(Object.entries({ mdpi: 24, hdpi: 36, xhdpi: 48, xxhdpi: 72, xxxhdpi: 96 }).map(async ([density, size]) => {
      const { source } = await generateImageAsync(
        { projectRoot, cacheType: 'psstpsst-notification' },
        { src: icon, width: size, height: size, resizeMode: 'cover', backgroundColor: 'transparent' },
      );
      const directory = join(mod.modRequest.platformProjectRoot, 'app/src/main/res', `drawable-${density}`);
      await mkdir(directory, { recursive: true });
      await writeFile(join(directory, 'notification_icon.png'), source);
    }));
    // Native notification modules resolve this drawable by name at runtime.
    const rawDirectory = join(mod.modRequest.platformProjectRoot, 'app/src/main/res/raw');
    await mkdir(rawDirectory, { recursive: true });
    await writeFile(join(rawDirectory, 'psstpsst_notification_keep.xml'),
      '<resources xmlns:tools="http://schemas.android.com/tools" tools:keep="@drawable/notification_icon" />\n');
    return mod;
  }]);
};
