/** Shared by the Electron main process and renderer before application content loads. */
export function desktopChromeForPlatform(os: string | undefined) {
  return {
    titlebarHeight: os === 'darwin' ? 28 : 40,
    applicationTitlebarHeight: 44,
    nativeControlsWidth: os === 'darwin' ? 80 : 144,
  } as const;
}
