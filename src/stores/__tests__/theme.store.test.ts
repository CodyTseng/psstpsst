import { getDevicePreference, trySetDevicePreference } from '@/services/preferences/device-preferences.service';
import { useThemeStore } from '../theme.store';
import { defaultThemePalettes } from '@/theme/palette';

jest.mock('@/services/preferences/device-preferences.service', () => ({
  getDevicePreference: jest.fn(),
  trySetDevicePreference: jest.fn(async () => {}),
}));

beforeEach(() => {
  jest.clearAllMocks();
  useThemeStore.setState({ preference: 'system', accent: 'blue', palettes: defaultThemePalettes, loaded: false });
});

it.each([
  ['#aBc', '#AABBCC'],
  ['teal', 'teal'],
  ['__proto__', 'blue'],
  ['invalid', 'blue'],
  [null, 'blue'],
])('restores stored accent %s safely', async (stored, expected) => {
  jest.mocked(getDevicePreference).mockImplementation(async (key) => key === 'theme.accent' ? stored : 'dark');
  await useThemeStore.getState().load();
  expect(useThemeStore.getState()).toMatchObject({ accent: expected, preference: 'dark', loaded: true });
});

it('applies immediately and persists normalized RGB using the existing device preference', () => {
  useThemeStore.getState().setAccent('#abc');
  expect(useThemeStore.getState().accent).toBe('#AABBCC');
  expect(trySetDevicePreference).toHaveBeenCalledWith('theme.accent', '#AABBCC');
  useThemeStore.getState().setAccent('rose');
  expect(useThemeStore.getState().accent).toBe('rose');
  expect(trySetDevicePreference).toHaveBeenLastCalledWith('theme.accent', 'rose');
});

it('does not apply or persist invalid runtime input', () => {
  useThemeStore.getState().setAccent('#invalid');
  expect(useThemeStore.getState().accent).toBe('blue');
  expect(trySetDevicePreference).not.toHaveBeenCalled();
});

it('restores the custom colour and both foregrounds together from persistence', async () => {
  jest.mocked(getDevicePreference).mockImplementation(async (key) => key === 'theme.accent' ? '#000000' : 'system');
  await useThemeStore.getState().load();
  const state = useThemeStore.getState();
  expect(state.accent).toBe('#000000');
  for (const scheme of ['light', 'dark'] as const) {
    expect(state.palettes[scheme]).toMatchObject({ accent: '#000000', accentForeground: '#FFFFFF' });
  }
});

it('persists and restores both explicit mode choices using the existing preference key', async () => {
  const custom = { light: { color: '#abc', foreground: 'white' }, dark: { color: '#123456', foreground: 'black' } } as const;
  useThemeStore.getState().setAccent(custom);
  const stored = jest.mocked(trySetDevicePreference).mock.calls.at(-1)![1];
  expect(JSON.parse(stored)).toEqual({ light: { color: '#AABBCC', foreground: 'white' }, dark: custom.dark });
  jest.mocked(getDevicePreference).mockImplementation(async (key) => key === 'theme.accent' ? stored : 'system');
  useThemeStore.getState().setAccent('blue');
  await useThemeStore.getState().load();
  expect(useThemeStore.getState().palettes.light).toMatchObject({ accent: '#AABBCC', accentForeground: '#FFFFFF' });
  expect(useThemeStore.getState().palettes.dark).toMatchObject({ accent: '#123456', accentForeground: '#000000' });
});

it('keeps an unset mode linked to the configured mode across reloads', async () => {
  const stored = JSON.stringify({ dark: { color: '#FFFF00', foreground: 'black' } });
  jest.mocked(getDevicePreference).mockImplementation(async (key) => key === 'theme.accent' ? stored : 'system');
  await useThemeStore.getState().load();
  expect(useThemeStore.getState().accent).toEqual({ dark: { color: '#FFFF00', foreground: 'black' } });
  expect(useThemeStore.getState().palettes.light.accent).toBe('#FFFF00');
  expect(useThemeStore.getState().palettes.light.accentForeground).toBe('#000000');
});
