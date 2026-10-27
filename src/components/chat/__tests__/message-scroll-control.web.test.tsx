/** @jest-environment jsdom */
import { act, createRef, type ReactNode } from 'react';

import { MessageScrollControl, type MessageScrollControlHandle } from '../MessageScrollControl';

jest.mock('react-native', () => ({ Platform: { OS: 'web' } }));
jest.mock('@/theme', () => ({ spacing: { lg: 16 } }));
jest.mock('@/theme/motion', () => ({ manipulationTiming: { duration: 200 } }));
jest.mock('react-native-reanimated', () => ({
  __esModule: true,
  default: { View: jest.requireActual('react-native-web/dist/cjs/exports/View') },
  useReducedMotion: () => false,
  useSharedValue: (value: number) => {
    const { useRef } = jest.requireActual('react');
    return useRef({ value, set(next: number) { this.value = next; } }).current;
  },
  useAnimatedStyle: (callback: () => unknown) => callback(),
  // Leave fade-out visually in progress to verify interaction stops immediately.
  withTiming: () => 1,
}));

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
// Avoid Expo's lazy native fetch implementation in this DOM-only test.
Object.defineProperty(globalThis, 'fetch', { configurable: true, writable: true, value: jest.fn() });
type DomRoot = { render(node: ReactNode): void; unmount(): void };
const { createRoot } = jest.requireActual<{ createRoot(container: Element): DomRoot }>('react-dom/client');

describe('MessageScrollControl web accessibility', () => {
  let container: HTMLDivElement;
  let root: DomRoot;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });
  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it('makes descendants inert and aria-hidden through the real RN Web View during fade-out', () => {
    const ref = createRef<MessageScrollControlHandle>();
    act(() => root.render(
      <MessageScrollControl ref={ref} pinned={false} bottomInset={0}>
        <button type="button">Jump to latest</button>
      </MessageScrollControl>,
    ));
    const wrapper = container.firstElementChild as HTMLElement;
    const button = container.querySelector('button')!;
    expect(wrapper.hasAttribute('inert')).toBe(true);
    expect(wrapper.getAttribute('aria-hidden')).toBe('true');
    expect(wrapper.style.pointerEvents).toBe('none');
    act(() => ref.current!.updateOffset(1200));
    act(() => ref.current!.updateOffset(1100));
    expect(wrapper.hasAttribute('inert')).toBe(false);
    expect(wrapper.hasAttribute('aria-hidden')).toBe(false);
    expect(wrapper.style.pointerEvents).toBe('auto');

    act(() => ref.current!.updateOffset(1200));
    expect(wrapper.style.opacity).toBe('1');
    expect(container.querySelector('button')).toBe(button);
    expect(wrapper.hasAttribute('inert')).toBe(true);
    expect(wrapper.getAttribute('aria-hidden')).toBe('true');
    expect(wrapper.style.pointerEvents).toBe('none');

    act(() => ref.current!.updateOffset(1100));
    expect(wrapper.hasAttribute('inert')).toBe(false);
    expect(wrapper.hasAttribute('aria-hidden')).toBe(false);
    expect(wrapper.style.pointerEvents).toBe('auto');
  });

  it('leaves a pinned unread action available to keyboard navigation', () => {
    const ref = createRef<MessageScrollControlHandle>();
    act(() => root.render(
      <MessageScrollControl ref={ref} pinned bottomInset={0}>
        <button type="button">Jump to unread</button>
      </MessageScrollControl>,
    ));
    const wrapper = container.firstElementChild!;
    expect(wrapper.hasAttribute('inert')).toBe(false);
    expect(wrapper.hasAttribute('aria-hidden')).toBe(false);
    const button = container.querySelector('button')!;
    button.focus();
    expect(document.activeElement).toBe(button);
  });
});
