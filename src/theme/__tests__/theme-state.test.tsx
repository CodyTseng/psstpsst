import { createElement } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';

import { useThemeStore } from '@/stores/theme.store';
import { useThemeColors } from '../index';
import * as palettes from '../palette';

jest.mock('@/services/preferences/device-preferences.service', () => ({
  getDevicePreference: jest.fn(),
  trySetDevicePreference: jest.fn(async () => {}),
}));

function Probe({ id }: { id: string }) {
  return createElement('palette-probe', { probeId: id, colors: useThemeColors() });
}
function Tree() { return <><Probe id="first" /><Probe id="second" /></>; }

let renderer: ReactTestRenderer;
afterEach(() => { act(() => renderer?.unmount()); jest.restoreAllMocks(); });

it.each(['teal', '#123457'] as const)('derives %s once on selection and shares global state with every consumer', (accent) => {
  useThemeStore.getState().setAccent('blue');
  useThemeStore.setState({ preference: 'light' });
  const compute = jest.spyOn(palettes, 'createThemePalettes');
  useThemeStore.getState().setAccent(accent);
  expect(compute).toHaveBeenCalledTimes(1);
  const selected = useThemeStore.getState().palettes;
  act(() => { renderer = create(<Tree />); });
  const first = renderer.root.findByProps({ probeId: 'first' }).props.colors;
  const second = renderer.root.findByProps({ probeId: 'second' }).props.colors;
  expect(first).toBe(selected.light);
  expect(second).toBe(selected.light);
  act(() => { renderer.update(<Tree />); });
  act(() => { useThemeStore.getState().setPreference('dark'); });
  expect(renderer.root.findByProps({ probeId: 'first' }).props.colors).toBe(selected.dark);
  act(() => { useThemeStore.getState().setPreference('light'); });
  expect(renderer.root.findByProps({ probeId: 'first' }).props.colors).toBe(selected.light);
  expect(compute).toHaveBeenCalledTimes(1);
  act(() => { useThemeStore.getState().setAccent(accent); });
  expect(compute).toHaveBeenCalledTimes(1);
  act(() => { useThemeStore.getState().setAccent('rose'); });
  act(() => { useThemeStore.getState().setAccent(accent); });
  expect(compute).toHaveBeenCalledTimes(3);
  expect(useThemeStore.getState().palettes).not.toBe(selected);
});

it('publishes the chosen colour and its foreground in one store update', () => {
  useThemeStore.getState().setAccent('blue');
  const observed: string[] = [];
  const unsubscribe = useThemeStore.subscribe((state) => {
    observed.push(`${state.accent}:${state.palettes.light.accent}:${state.palettes.light.accentForeground}`);
  });
  useThemeStore.getState().setAccent('#000000');
  unsubscribe();
  expect(observed).toEqual(['#000000:#000000:#FFFFFF']);
});

it.each([
  ['#A78BFA', '#000000'],
  ['#FB923C', '#000000'],
] as const)('uses the same foreground for custom %s in both modes', (accent, foreground) => {
  useThemeStore.getState().setAccent(accent);
  const current = useThemeStore.getState().palettes;
  expect(current.light.accent).toBe(accent);
  expect(current.dark.accent).toBe(accent);
  expect(current.light.accentForeground).toBe(foreground);
  expect(current.dark.accentForeground).toBe(foreground);
  expect(current.light.accentForegroundMuted).toBe(current.dark.accentForegroundMuted);
  expect(current.light.accentForegroundSoft).toBe(current.dark.accentForegroundSoft);
});

it('shares independent per-mode foreground choices with all consumers', () => {
  useThemeStore.getState().setAccent({
    light: { color: '#123456', foreground: 'white' },
    dark: { color: '#123456', foreground: 'black' },
  });
  useThemeStore.setState({ preference: 'light' });
  act(() => { renderer = create(<Tree />); });
  expect(renderer.root.findByProps({ probeId: 'first' }).props.colors.accentForeground).toBe('#FFFFFF');
  act(() => { useThemeStore.getState().setPreference('dark'); });
  const first = renderer.root.findByProps({ probeId: 'first' }).props.colors;
  expect(first.accent).toBe('#123456');
  expect(first.accentForeground).toBe('#000000');
  expect(renderer.root.findByProps({ probeId: 'second' }).props.colors).toBe(first);
});
