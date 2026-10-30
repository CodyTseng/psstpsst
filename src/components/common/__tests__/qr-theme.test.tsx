import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { Image, StyleSheet, View } from 'react-native';
import QRCodeStyled from 'react-native-qrcode-styled';
import { captureRef } from 'react-native-view-shot';

import { useThemeStore } from '@/stores/theme.store';
import { QrCode } from '../QrCode';

jest.mock('@/services/preferences/device-preferences.service', () => ({
  getDevicePreference: jest.fn(), trySetDevicePreference: jest.fn(async () => {}),
}));
jest.mock('react-native-qrcode-styled', () => ({ __esModule: true, default: () => null }));
jest.mock('react-native-view-shot', () => ({ captureRef: jest.fn(async () => 'file://qr-capture.png') }));

let renderer: ReactTestRenderer;
const idle = global.requestIdleCallback;
const cancelIdle = global.cancelIdleCallback;
beforeEach(() => {
  jest.useFakeTimers();
  global.requestIdleCallback = (callback) => setTimeout(() => callback({ didTimeout: false, timeRemaining: () => 50 }), 0) as unknown as number;
  global.cancelIdleCallback = (handle) => clearTimeout(handle);
  useThemeStore.getState().setAccent('blue');
  useThemeStore.setState({ preference: 'light' });
});
afterEach(() => {
  act(() => renderer?.unmount());
  jest.clearAllTimers();
  jest.useRealTimers();
  jest.clearAllMocks();
  global.requestIdleCallback = idle;
  global.cancelIdleCallback = cancelIdle;
});

it.each(['light', 'dark'] as const)('draws the QR and its captured background from global colours in %s mode', (scheme) => {
  useThemeStore.getState().setAccent({ light: { color: '#FFFF00', foreground: 'black' } });
  useThemeStore.setState({ preference: scheme });
  act(() => { renderer = create(<QrCode data={`qr-${scheme}`} size={216} />); });
  act(() => { jest.advanceTimersByTime(1); });
  const c = useThemeStore.getState().palettes[scheme];
  const qr = renderer.root.findByType(QRCodeStyled);
  expect(qr.props.color).toBe(c.accent);
  expect(StyleSheet.flatten(qr.props.style).backgroundColor).toBe(c.accentForeground);
  expect(renderer.root.findAllByType(View).map((node) => StyleSheet.flatten(node.props.style)?.backgroundColor)).toContain(c.accentForeground);
});

it('reuses matching raster output and never reuses stale pixels after a theme change', async () => {
  act(() => { renderer = create(<QrCode data="cached-theme-test" size={216} color="#3A76F0" />); });
  act(() => { jest.advanceTimersByTime(1); });
  await act(async () => { jest.advanceTimersByTime(250); });
  expect(captureRef).toHaveBeenCalledTimes(1);
  act(() => renderer.unmount());
  act(() => { renderer = create(<QrCode data="cached-theme-test" size={216} color="#3A76F0" />); });
  expect(renderer.root.findByType(Image).props.source.uri).toBe('file://qr-capture.png');
  act(() => { useThemeStore.getState().setAccent({ light: { color: '#FFFF00', foreground: 'black' } }); });
  expect(renderer.root.findAllByType(Image)).toHaveLength(0);
  act(() => { jest.advanceTimersByTime(1); });
  expect(renderer.root.findByType(QRCodeStyled).props.color).toBe('#3A76F0');
  expect(StyleSheet.flatten(renderer.root.findByType(QRCodeStyled).props.style).backgroundColor).toBe('#000000');
});
