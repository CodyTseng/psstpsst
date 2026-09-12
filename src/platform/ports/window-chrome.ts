/** Theme applied to platform-owned window chrome (the desktop title bar area). */
export type WindowChromeTheme = {
  /** Opaque hex colour of the app page, used for the pre-paint window fill. */
  backgroundColor: string;
  /** Opaque hex colour of the renderer-drawn title bar (caption overlay fill). */
  titlebarColor: string;
  /** Colour of the native minimize/maximize/close glyphs (Windows/Linux overlay). */
  symbolColor: string;
  /** Let renderer content show beneath the native title-bar controls. */
  transparentTitlebar?: boolean;
};

/**
 * Styles the OS-drawn parts of the desktop window frame so they follow the app
 * theme. Mobile has no window chrome to style; the Expo adapter is a no-op.
 */
export interface WindowChromePort {
  setTheme(theme: WindowChromeTheme): Promise<void>;
  /** Size the desktop window for promotional capture, restoring it on exit. */
  setScreenshotPreview(enabled: boolean): Promise<void>;
}
