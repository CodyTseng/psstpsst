/** @jest-environment jsdom */
import { act, type ReactNode } from 'react';

import { MediaPageFrame } from '../MediaPageFrame.web';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
type DomRoot = { render: (node: ReactNode) => void; unmount: () => void };
const { createRoot } = jest.requireActual<{ createRoot: (container: Element) => DomRoot }>('react-dom/client');
let container: HTMLDivElement;
let root: DomRoot;
function render(width = 960) {
  act(() => { root.render(<MediaPageFrame width={width} height={720}><div data-testid="image" /></MediaPageFrame>); });
}
function wheel(deltaX: number, options: WheelEventInit = {}) {
  const event = new WheelEvent('wheel', { deltaX, bubbles: true, cancelable: true, ...options });
  container.querySelector('[data-testid="image"]')!.dispatchEvent(event);
  return event;
}
beforeEach(() => {
  container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container);
});
afterEach(() => { act(() => root.unmount()); container.remove(); });

it('leaves repeated swipes and their inertial events available to native scrolling', () => {
  render();
  const bubbled = jest.fn();
  container.addEventListener('wheel', bubbled);
  for (const delta of [120, 80, 40, 10, 1, 120, -120]) {
    expect(wheel(delta).defaultPrevented).toBe(false);
  }
  expect(bubbled).toHaveBeenCalledTimes(7);
});

it('stops at each snap area without replacing the image surface after resize', () => {
  render();
  const image = container.querySelector('[data-testid="image"]');
  const frame = container.firstElementChild as HTMLDivElement;
  expect(frame.style.scrollSnapStop).toBe('always');
  expect(frame.style.scrollSnapAlign).toBe('start');
  render(1280);
  expect(container.querySelector('[data-testid="image"]')).toBe(image);
  expect(wheel(120).defaultPrevented).toBe(false);
});

it('preserves pinch and modified wheel events for the image controls', () => {
  render();
  expect(wheel(120, { ctrlKey: true }).defaultPrevented).toBe(false);
  expect(wheel(120, { shiftKey: true }).defaultPrevented).toBe(false);
});
