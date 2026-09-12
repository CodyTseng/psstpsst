import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  fitWindowBounds,
  parseWindowState,
  SCREENSHOT_PREVIEW_HEIGHT,
  SCREENSHOT_PREVIEW_WIDTH,
  ScreenshotPreviewWindow,
  WindowStateStore,
} from '../window-state';

let directory: string;
beforeEach(async () => { directory = await fs.mkdtemp(path.join(os.tmpdir(), 'psstpsst-window-')); });
afterEach(async () => { await fs.rm(directory, { recursive: true, force: true }); });

it('restores the latest normal bounds and maximization after a restart, flushing pending events', async () => {
  const file = path.join(directory, 'window-state.json');
  const store = new WindowStateStore(file);
  await store.load();
  expect(store.state).toBeNull();
  let bounds = { x: 20, y: 40, width: 1000, height: 800 };
  let maximized = false;
  let minimized = false;
  const window = {
    isDestroyed: () => false, isMinimized: () => minimized, isFullScreen: () => false,
    getNormalBounds: () => bounds, isMaximized: () => maximized,
  };
  store.capture(window);
  const firstWrite = store.flush();
  bounds = { x: 60, y: 80, width: 1200, height: 900 };
  maximized = true;
  store.capture(window);
  await store.flush();
  await firstWrite;
  minimized = true;
  maximized = false;
  store.capture(window);
  await store.flush();
  const restored = new WindowStateStore(file);
  await restored.load();
  expect(restored.state).toEqual({ bounds, maximized: true });
});

it('keeps a restored window on the available display after removing a monitor', () => {
  expect(fitWindowBounds(
    { x: 2000, y: -100, width: 1600, height: 1000 },
    { x: 0, y: 25, width: 1280, height: 775 },
  )).toEqual({ x: 0, y: 25, width: 1280, height: 775 });
  expect(fitWindowBounds(
    { x: -1500, y: 100, width: 900, height: 600 },
    { x: -1920, y: 0, width: 1920, height: 1080 },
  )).toEqual({ x: -1500, y: 100, width: 900, height: 600 });
});

it('rejects malformed or unusable disk geometry', () => {
  for (const value of [null, {}, { bounds: { x: 0, y: 0, width: 100, height: 600 }, maximized: false },
    { bounds: { x: Infinity, y: 0, width: 900, height: 600 }, maximized: false }]) {
    expect(parseWindowState(value)).toBeNull();
  }
});

it('sizes screenshot preview without disabling resize controls and restores the window', () => {
  const original = { x: 80, y: 60, width: 1000, height: 760 };
  let bounds = { ...original };
  let maximized = true;
  let maximizable = true;
  let fullScreenable = true;
  let resizable = true;
  const window = {
    getBounds: () => bounds,
    getNormalBounds: () => original,
    isFullScreenable: () => fullScreenable,
    isMaximized: () => maximized,
    isMaximizable: () => maximizable,
    isResizable: () => resizable,
    maximize: jest.fn(() => { maximized = true; }),
    unmaximize: jest.fn(() => { maximized = false; }),
    setResizable: jest.fn((value: boolean) => { resizable = value; }),
    setContentSize: jest.fn((width: number, height: number) => {
      bounds = { ...bounds, width, height };
    }),
    setFullScreenable: jest.fn((value: boolean) => { fullScreenable = value; }),
    setMaximizable: jest.fn((value: boolean) => { maximizable = value; }),
    setBounds: jest.fn((value: typeof bounds) => { bounds = value; }),
  };
  const preview = new ScreenshotPreviewWindow();
  const workArea = { x: 0, y: 25, width: 1920, height: 1055 };

  preview.enter(window, workArea);

  expect(preview.active).toBe(true);
  expect(window.unmaximize).toHaveBeenCalledTimes(1);
  expect(window.setContentSize).toHaveBeenCalledWith(
    SCREENSHOT_PREVIEW_WIDTH,
    SCREENSHOT_PREVIEW_HEIGHT,
  );
  expect(bounds).toEqual({ x: 480, y: 192, width: 960, height: 720 });
  expect(resizable).toBe(true);
  expect(window.setMaximizable).not.toHaveBeenCalled();
  expect(window.setFullScreenable).not.toHaveBeenCalled();

  preview.exit(window, workArea);

  expect(preview.active).toBe(false);
  expect(bounds).toEqual(original);
  expect(window.maximize).toHaveBeenCalledTimes(1);
  expect(resizable).toBe(true);
  expect(maximizable).toBe(true);
  expect(fullScreenable).toBe(true);
});
