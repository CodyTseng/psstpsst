import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { Path, Rect } from 'react-native-svg';
import QRCodeStyled from 'react-native-qrcode-styled';

import { QrCode } from '../QrCode';

jest.mock('@/lib/platform', () => ({ IS_ELECTRON: true }));
jest.mock('@/services/preferences/device-preferences.service', () => ({
  getDevicePreference: jest.fn(), trySetDevicePreference: jest.fn(async () => {}),
}));
jest.mock('react-native-qrcode-styled', () => ({ __esModule: true, default: () => null }));
jest.mock('react-native-view-shot', () => ({ captureRef: jest.fn(async () => 'file://qr.png') }));

let renderer: ReactTestRenderer;
let pieces: ReactTestRenderer;
const idle = global.requestIdleCallback;
const cancelIdle = global.cancelIdleCallback;
beforeEach(() => {
  jest.useFakeTimers();
  global.requestIdleCallback = callback => setTimeout(() => callback({ didTimeout: false, timeRemaining: () => 50 }), 0) as unknown as number;
  global.cancelIdleCallback = handle => clearTimeout(handle);
});
afterEach(() => {
  act(() => { renderer?.unmount(); pieces?.unmount(); });
  jest.clearAllTimers();
  jest.useRealTimers();
  global.requestIdleCallback = idle;
  global.cancelIdleCallback = cancelIdle;
});

it.each([21, 177])('keeps desktop SVG node count bounded for a %s-module QR', size => {
  act(() => { renderer = create(<QrCode data={`desktop-${size}`} size={220} />); });
  act(() => { jest.advanceTimersByTime(1); });
  const draw = renderer.root.findByType(QRCodeStyled).props.renderCustomPieceItem;
  const bitMatrix = Array.from({ length: size }, () => Array<number>(size).fill(1));
  const input = { pieceSize: 2, qrSize: size * 2, bitMatrix };
  expect(draw({ ...input, x: 1, y: 0 })).toBeNull();
  act(() => { pieces = create(draw({ ...input, x: 0, y: 0 })); });
  const paths = pieces.root.findAllByType(Path);
  expect(paths).toHaveLength(1);
  expect(pieces.root.findAllByType(Rect)).toHaveLength(6);
  // Each non-finder module remains an independent circular subpath.
  expect(paths[0].props.d.split('Z')).toHaveLength(size * size - 3 * 49 + 1);
  expect(paths[0].props.d).toContain('M8.5 8a.5.5 0 1 1 0 1a.5.5 0 1 1 0-1Z');
  expect(paths[0].props.d).not.toContain('M0.5 0a');
});
