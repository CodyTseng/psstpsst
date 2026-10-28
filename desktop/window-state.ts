import { promises as fs } from 'node:fs';
import writeFileAtomic from 'write-file-atomic';
import type { BrowserWindow, Rectangle } from 'electron';

export const WINDOW_MIN_WIDTH = 380;
export const WINDOW_MIN_HEIGHT = 480;
export const SCREENSHOT_PREVIEW_WIDTH = 960;
export const SCREENSHOT_PREVIEW_HEIGHT = 720;

type WindowState = { bounds: Rectangle; maximized: boolean };

/** Validate disk input before passing geometry to Electron. */
export function parseWindowState(value: unknown): WindowState | null {
  if (!value || typeof value !== 'object') return null;
  const { bounds, maximized } = value as Partial<WindowState>;
  if (!bounds || typeof maximized !== 'boolean') return null;
  if (![bounds.x, bounds.y, bounds.width, bounds.height].every(Number.isSafeInteger)) return null;
  if (bounds.width < WINDOW_MIN_WIDTH || bounds.height < WINDOW_MIN_HEIGHT) return null;
  return { bounds: { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height }, maximized };
}

/** A removed monitor or smaller work area must not strand the title bar. */
export function fitWindowBounds(bounds: Rectangle, area: Rectangle): Rectangle {
  const width = Math.max(WINDOW_MIN_WIDTH, Math.min(bounds.width, area.width));
  const height = Math.max(WINDOW_MIN_HEIGHT, Math.min(bounds.height, area.height));
  return {
    width, height,
    x: Math.max(area.x, Math.min(bounds.x, area.x + area.width - width)),
    y: Math.max(area.y, Math.min(bounds.y, area.y + area.height - height)),
  };
}

const APPLICATION_WINDOW_GAP = 16;
const APPLICATION_WINDOW_OFFSET = 32;

/** Keep the launching window visible without moving or resizing it. */
export function placeApplicationWindow(source: Rectangle, preferred: Rectangle, area: Rectangle): Rectangle {
  const fitted = fitWindowBounds(preferred, area);
  const clampX = (x: number) => Math.max(area.x, Math.min(x, area.x + area.width - fitted.width));
  const clampY = (y: number) => Math.max(area.y, Math.min(y, area.y + area.height - fitted.height));
  const beside = [
    { x: source.x + source.width + APPLICATION_WINDOW_GAP, y: clampY(source.y) },
    { x: source.x - fitted.width - APPLICATION_WINDOW_GAP, y: clampY(source.y) },
    { x: clampX(source.x), y: source.y + source.height + APPLICATION_WINDOW_GAP },
    { x: clampX(source.x), y: source.y - fitted.height - APPLICATION_WINDOW_GAP },
  ];
  const free = beside.find(({ x, y }) => x >= area.x && y >= area.y &&
    x + fitted.width <= area.x + area.width && y + fitted.height <= area.y + area.height);
  if (free) return { ...fitted, ...free };

  // Reverse the cascade at display edges instead of clamping onto the source.
  const offset = (value: number, clamp: (value: number) => number) => {
    const forward = clamp(value + APPLICATION_WINDOW_OFFSET);
    return forward > value ? forward : clamp(value - APPLICATION_WINDOW_OFFSET);
  };
  return { ...fitted, x: offset(source.x, clampX), y: offset(source.y, clampY) };
}

type PreviewWindow = Pick<
  BrowserWindow,
  | 'getBounds'
  | 'getNormalBounds'
  | 'isMaximized'
  | 'isResizable'
  | 'maximize'
  | 'setBounds'
  | 'setContentSize'
  | 'setResizable'
  | 'unmaximize'
>;

type PreviewRestoreState = {
  bounds: Rectangle;
  maximized: boolean;
  resizable: boolean;
};

/** Own the temporary promotional canvas without persisting it as user geometry. */
export class ScreenshotPreviewWindow {
  private restoreState: PreviewRestoreState | null = null;

  get active(): boolean {
    return this.restoreState !== null;
  }

  enter(window: PreviewWindow, workArea: Rectangle): void {
    if (this.restoreState) return;
    this.restoreState = {
      bounds: window.getNormalBounds(),
      maximized: window.isMaximized(),
      resizable: window.isResizable(),
    };
    if (this.restoreState.maximized) window.unmaximize();
    window.setResizable(true);
    window.setContentSize(SCREENSHOT_PREVIEW_WIDTH, SCREENSHOT_PREVIEW_HEIGHT);
    const bounds = window.getBounds();
    window.setBounds({
      ...bounds,
      x: Math.max(workArea.x, workArea.x + Math.floor((workArea.width - bounds.width) / 2)),
      y: Math.max(workArea.y, workArea.y + Math.floor((workArea.height - bounds.height) / 2)),
    });
  }

  exit(window: PreviewWindow, workArea: Rectangle): void {
    const restore = this.restoreState;
    if (!restore) return;
    this.restoreState = null;
    window.setResizable(true);
    window.setBounds(fitWindowBounds(restore.bounds, workArea));
    if (restore.maximized) window.maximize();
    window.setResizable(restore.resizable);
  }
}

/** Main-process boot geometry is available before renderer SQLite migrations.
 * Debounce events, serialize atomic writes, and drain them before shutdown. */
export class WindowStateStore {
  state: WindowState | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private writes: Promise<void> = Promise.resolve();
  private dirty = false;

  constructor(private readonly filePath: string) {}

  async load(): Promise<void> {
    try {
      this.state = parseWindowState(JSON.parse(await fs.readFile(this.filePath, 'utf8')));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        console.warn('[window] Failed to restore window state.', error);
      }
    }
  }

  capture(window: Pick<BrowserWindow, 'isDestroyed' | 'isMinimized' | 'isFullScreen' | 'getNormalBounds' | 'isMaximized'>): void {
    if (window.isDestroyed() || window.isMinimized() || window.isFullScreen()) return;
    const next = parseWindowState({ bounds: window.getNormalBounds(), maximized: window.isMaximized() });
    if (!next || JSON.stringify(next) === JSON.stringify(this.state)) return;
    this.state = next;
    this.dirty = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => { void this.flush(); }, 250);
  }

  flush(): Promise<void> {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    if (this.dirty && this.state) {
      const serialized = JSON.stringify(this.state);
      this.dirty = false;
      this.writes = this.writes.then(async () => {
        await writeFileAtomic(this.filePath, serialized);
      }).catch((error) => {
        this.dirty = true;
        console.warn('[window] Failed to save window state.', error);
      });
    }
    return this.writes;
  }
}
