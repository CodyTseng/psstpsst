export type DesktopDateTimeSettings = { locale: string | null; uses24HourClock: boolean | null };

type Options = {
  platform: NodeJS.Platform;
  locale(): string | null;
  desktop: string;
  helperPath: string;
  run(file: string, args: string[]): Promise<string>;
};

function clockPreference(output: string): boolean | null {
  // D-Bus variants and GSettings quote strings; the native helpers return a bare token.
  const match = /^(?:\(<|<)?\s*['"]?(12h|24h)['"]?\s*(?:>,?\)|>)?\s*$/.exec(output.trim());
  return match ? match[1] === '24h' : null;
}

/** One bounded async OS read shared by simultaneous main and leaf-host refreshes. */
export class DesktopLocalization {
  private pending: Promise<DesktopDateTimeSettings> | undefined;

  constructor(private readonly options: Options) {}

  read(): Promise<DesktopDateTimeSettings> {
    if (this.pending) return this.pending;
    const pending = this.readSettings().finally(() => { if (this.pending === pending) this.pending = undefined; });
    this.pending = pending;
    return pending;
  }

  private async readSettings(): Promise<DesktopDateTimeSettings> {
    const locale = this.options.locale();
    const uses24HourClock = await this.readClock();
    return { locale, uses24HourClock };
  }

  private async attempt(file: string, args: string[]): Promise<boolean | null> {
    try {
      return clockPreference(await this.options.run(file, args));
    } catch {
      // A missing helper, settings backend or session bus leaves the preference unknown.
      return null;
    }
  }

  private async readClock(): Promise<boolean | null> {
    if (this.options.platform === 'darwin' || this.options.platform === 'win32') {
      return this.attempt(this.options.helperPath, []);
    }
    if (this.options.platform !== 'linux') return null;
    // GNOME settings are not authoritative for unrelated desktops, even if installed.
    if (!this.options.desktop.split(/[:;]/).some(name => name.toLowerCase() === 'gnome')) return null;
    const portal = await this.attempt('gdbus', [
      'call', '--session', '--dest', 'org.freedesktop.portal.Desktop',
      '--object-path', '/org/freedesktop/portal/desktop', '--method',
      'org.freedesktop.portal.Settings.ReadOne', 'org.gnome.desktop.interface', 'clock-format',
    ]);
    if (portal != null) return portal;
    return this.attempt('gsettings', ['get', 'org.gnome.desktop.interface', 'clock-format']);
  }
}
