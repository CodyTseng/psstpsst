export type MacNotificationPermissions = {
  hasPermission(): Promise<boolean>;
  requestPermission(): Promise<boolean>;
};

type Options = {
  platform: NodeJS.Platform;
  isSupported(): boolean;
  loadMacPermissions(): MacNotificationPermissions;
  openExternal(url: string): Promise<void>;
};

/** OS authorization is separate from Electron's notification capability probe. */
export class DesktopNotificationPermissions {
  private native: MacNotificationPermissions | undefined;
  private requesting: Promise<boolean> | undefined;

  constructor(private readonly options: Options) {}

  isSupported(): boolean {
    // Electron 43's probe initializes UNUserNotificationCenter and requests
    // authorization. Avoid that side effect during preload on macOS.
    return this.options.platform === 'darwin' || this.options.isSupported();
  }

  async hasPermission(): Promise<boolean> {
    if (this.options.platform !== 'darwin') return this.options.isSupported();
    return this.mac().hasPermission();
  }

  ensurePermission(): Promise<boolean> {
    if (this.requesting) return this.requesting;
    this.requesting = this.request().finally(() => { this.requesting = undefined; });
    return this.requesting;
  }

  async openSettings(): Promise<boolean> {
    if (this.options.platform !== 'darwin') return false;
    await this.options.openExternal('x-apple.systempreferences:com.apple.Notifications-Settings.extension');
    return true;
  }

  private async request(): Promise<boolean> {
    if (this.options.platform !== 'darwin') return this.options.isSupported();
    return this.mac().requestPermission();
  }

  private mac(): MacNotificationPermissions {
    this.native ??= this.options.loadMacPermissions();
    return this.native;
  }
}
