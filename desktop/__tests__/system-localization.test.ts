import { DesktopLocalization } from '../system-localization';

function setup(platform: NodeJS.Platform = 'darwin', desktop = '') {
  const options = {
    platform, desktop, locale: jest.fn(() => 'en-CN'), helperPath: '/native/system-localization',
    run: jest.fn(async (_file: string, _args: string[]) => '24h\n'),
  };
  return { options, reader: new DesktopLocalization(options) };
}

it.each(['darwin', 'win32'] as const)('reads an OS override independently of the %s locale default', async platform => {
  const { reader, options } = setup(platform);
  await expect(reader.read()).resolves.toEqual({ locale: 'en-CN', uses24HourClock: true });
  expect(options.run).toHaveBeenCalledWith('/native/system-localization', []);
  options.run.mockResolvedValue('12h\n');
  await expect(reader.read()).resolves.toEqual({ locale: 'en-CN', uses24HourClock: false });
});

it('shares concurrent reads without caching settled preferences', async () => {
  const { reader, options } = setup();
  let finish!: (value: string) => void;
  options.run.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const first = reader.read();
  const second = reader.read();
  expect(second).toBe(first);
  expect(options.run).toHaveBeenCalledTimes(1);
  finish('24h');
  await first;
  options.run.mockResolvedValue('12h');
  await expect(reader.read()).resolves.toMatchObject({ uses24HourClock: false });
  expect(options.run).toHaveBeenCalledTimes(2);
});

it.each(['unknown', '', 'invalid 24h output'])('leaves unrecognized OS output unknown: %s', async output => {
  const { reader, options } = setup();
  options.run.mockResolvedValue(output);
  await expect(reader.read()).resolves.toMatchObject({ uses24HourClock: null });
});

it('returns a regional fallback on a missing helper or timeout and retries on the next refresh', async () => {
  const { reader, options } = setup();
  options.run.mockRejectedValueOnce(new Error('timeout'));
  await expect(reader.read()).resolves.toEqual({ locale: 'en-CN', uses24HourClock: null });
  await expect(reader.read()).resolves.toMatchObject({ uses24HourClock: true });
});

it.each(["(<'24h'>,)", "(<'12h'>,)"])('reads a GNOME portal variant %s without an extra settings process', async output => {
  const { reader, options } = setup('linux', 'ubuntu:GNOME');
  options.run.mockResolvedValue(output);
  await expect(reader.read()).resolves.toMatchObject({ uses24HourClock: output.includes('24h') });
  expect(options.run).toHaveBeenCalledTimes(1);
  expect(options.run.mock.calls[0][0]).toBe('gdbus');
});

it('uses GNOME settings when the session portal is unavailable', async () => {
  const { reader, options } = setup('linux', 'GNOME');
  options.run.mockRejectedValueOnce(new Error('No portal')).mockResolvedValueOnce("'12h'\n");
  await expect(reader.read()).resolves.toMatchObject({ uses24HourClock: false });
  expect(options.run).toHaveBeenLastCalledWith('gsettings', ['get', 'org.gnome.desktop.interface', 'clock-format']);
});

it.each(['KDE', 'XFCE', ''])('does not treat an installed GNOME schema as the clock preference for %s', async desktop => {
  const { reader, options } = setup('linux', desktop);
  await expect(reader.read()).resolves.toMatchObject({ uses24HourClock: null });
  expect(options.run).not.toHaveBeenCalled();
});
