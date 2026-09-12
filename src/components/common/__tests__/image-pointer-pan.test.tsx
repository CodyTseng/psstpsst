/** @jest-environment jsdom */
import { act, type ReactNode } from 'react';

import { ImagePointerPan } from '../ImagePointerPan.web';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

// The project does not ship react-dom type declarations.
type DomRoot = { render: (node: ReactNode) => void; unmount: () => void };
const { createRoot } = jest.requireActual<{ createRoot: (container: Element) => DomRoot }>('react-dom/client');
let container: HTMLDivElement;
let root: DomRoot;
const start = jest.fn();
const move = jest.fn();
const wheelPan = jest.fn();
const wheelZoom = jest.fn();
const reset = jest.fn();
const singleClick = jest.fn();
const nestedDown = jest.fn();
const nestedMove = jest.fn();
const captures = new Set<number>();

function render(enabled = true) {
  act(() => {
    root.render(
      <ImagePointerPan
        enabled={enabled}
        onStart={start}
        onMove={move}
        onWheelPan={wheelPan}
        onWheelZoom={wheelZoom}
        onSingleClick={singleClick}
        onDoubleClick={reset}
      >
        <div data-testid="image" onPointerDown={nestedDown} onPointerMove={nestedMove} />
      </ImagePointerPan>,
    );
  });
}
function pointer(type: string, x: number, y: number, options: { pointerId?: number; pointerType?: string; button?: number } = {}) {
  const event = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, button: options.button ?? 0 });
  Object.defineProperties(event, {
    pointerId: { value: options.pointerId ?? 1 },
    pointerType: { value: options.pointerType ?? 'mouse' },
  });
  const target = captures.has(options.pointerId ?? 1) ? container.firstElementChild! : container.querySelector('[data-testid="image"]')!;
  act(() => { target.dispatchEvent(event); });
  return event;
}

function wheel(deltaX: number, deltaY: number, options: { ctrlKey?: boolean; clientX?: number; clientY?: number } = {}) {
  const event = new WheelEvent('wheel', {
    bubbles: true,
    cancelable: true,
    ctrlKey: options.ctrlKey,
    clientX: options.clientX,
    clientY: options.clientY,
    deltaX,
    deltaY,
  });
  act(() => { container.firstElementChild!.dispatchEvent(event); });
  return event;
}

beforeEach(() => {
  jest.useFakeTimers();
  jest.clearAllMocks();
  captures.clear();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  // jsdom has no pointer capture; model its target routing without mocking React events.
  HTMLElement.prototype.setPointerCapture = jest.fn((id: number) => { captures.add(id); });
  HTMLElement.prototype.hasPointerCapture = (id: number) => captures.has(id);
  HTMLElement.prototype.releasePointerCapture = jest.fn((id: number) => { captures.delete(id); });
});
afterEach(() => {
  act(() => { root.unmount(); });
  container.remove();
  jest.useRealTimers();
});

it('captures mouse drags before nested recognizers and tracks movement beyond the image', () => {
  render();
  expect(pointer('pointerdown', 100, 80).defaultPrevented).toBe(true);
  expect(start).toHaveBeenCalledTimes(1);
  expect(nestedDown).not.toHaveBeenCalled();
  expect(captures.has(1)).toBe(true);
  expect((container.firstElementChild as HTMLElement).style.cursor).toBe('grabbing');
  pointer('pointermove', 350, -40);
  expect(move).toHaveBeenLastCalledWith(250, -120);
  expect(nestedMove).not.toHaveBeenCalled();
  pointer('pointerup', 400, -60);
  expect(move).toHaveBeenLastCalledWith(300, -140);
  expect(captures.size).toBe(0);
  expect((container.firstElementChild as HTMLElement).style.cursor).toBe('grab');
  move.mockClear();
  pointer('pointermove', 500, 200);
  expect(move).not.toHaveBeenCalled();
});

it.each(['pointercancel', 'lostpointercapture'])('ends %s cleanly and starts the next drag from its own origin', (end) => {
  render();
  pointer('pointerdown', 100, 80);
  pointer('pointermove', 200, 100, { pointerId: 2 });
  expect(move).not.toHaveBeenCalled();
  pointer(end, 0, 0);
  pointer('pointermove', 300, 300);
  expect(move).not.toHaveBeenCalled();
  pointer('pointerdown', 20, 30);
  pointer('pointermove', 35, 50);
  expect(move).toHaveBeenLastCalledWith(15, 20);
});

it('leaves touch, secondary mouse buttons, and unzoomed gestures to the nested detector', () => {
  render();
  pointer('pointerdown', 100, 80, { pointerType: 'touch' });
  pointer('pointerdown', 100, 80, { button: 2 });
  expect(start).not.toHaveBeenCalled();
  expect(nestedDown).toHaveBeenCalledTimes(2);
  render(false);
  pointer('pointerdown', 100, 80);
  expect(start).not.toHaveBeenCalled();
  expect(nestedDown).toHaveBeenCalledTimes(3);
});

it('turns trackpad wheel input into zoom-at-point and zoomed image panning', () => {
  render(false);
  jest.spyOn(container.firstElementChild!, 'getBoundingClientRect').mockReturnValue({
    left: 10,
    top: 20,
    width: 400,
    height: 300,
    right: 410,
    bottom: 320,
    x: 10,
    y: 20,
    toJSON: () => ({}),
  });

  const pinch = wheel(0, -20, { ctrlKey: true, clientX: 310, clientY: 120 });
  expect(pinch.defaultPrevented).toBe(true);
  expect(wheelZoom).toHaveBeenCalledWith(Math.exp(0.2), 100, -50);

  const idlePan = wheel(12, -8);
  expect(idlePan.defaultPrevented).toBe(false);
  expect(wheelPan).not.toHaveBeenCalled();

  render(true);
  const pan = wheel(12, -8);
  expect(pan.defaultPrevented).toBe(true);
  expect(wheelPan).toHaveBeenCalledWith(-12, 8);
});

it('stops updating after zoom is reset and preserves double-click reset while zoomed', () => {
  render();
  act(() => { container.firstElementChild!.dispatchEvent(new MouseEvent('dblclick', { bubbles: true })); });
  expect(reset).toHaveBeenCalledTimes(1);
  pointer('pointerdown', 100, 80);
  render(false);
  pointer('pointermove', 200, 160);
  expect(move).not.toHaveBeenCalled();
  pointer('pointerup', 200, 160);
  expect(captures.size).toBe(0);
});


function click(detail: number) {
  pointer('pointerdown', 100, 80);
  pointer('pointerup', 100, 80);
  act(() => {
    container.firstElementChild!.dispatchEvent(new MouseEvent('click', { bubbles: true, detail }));
  });
}

it.each([false, true])('handles double-click once with zoomed=%s and cancels pending dismissal', (zoomed) => {
  render(zoomed);
  click(1);
  act(() => { jest.advanceTimersByTime(300); });
  expect(singleClick).not.toHaveBeenCalled();
  click(2);
  act(() => {
    container.firstElementChild!.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, detail: 2 }));
    jest.runOnlyPendingTimers();
  });
  expect(reset).toHaveBeenCalledTimes(1);
  expect(singleClick).not.toHaveBeenCalled();
});

it('dismisses a single click only after waiting, and never dismisses the click after a drag', () => {
  render(false);
  click(1);
  expect(singleClick).not.toHaveBeenCalled();
  act(() => { jest.runOnlyPendingTimers(); });
  expect(singleClick).toHaveBeenCalledTimes(1);
  singleClick.mockClear();
  pointer('pointerdown', 100, 80);
  pointer('pointermove', 140, 100);
  pointer('pointerup', 140, 100);
  act(() => {
    container.firstElementChild!.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }));
    jest.runOnlyPendingTimers();
  });
  expect(singleClick).not.toHaveBeenCalled();
});

it('clears pending single-click dismissal on unmount', () => {
  render(false);
  click(1);
  act(() => { root.render(null); });
  act(() => { jest.runOnlyPendingTimers(); });
  expect(singleClick).not.toHaveBeenCalled();
});
