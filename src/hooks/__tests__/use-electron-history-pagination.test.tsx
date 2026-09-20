import { act, create, type ReactTestRenderer } from 'react-test-renderer';

import { useElectronHistoryPagination } from '../use-electron-history-pagination';

jest.mock('@/lib/platform', () => ({ IS_ELECTRON: true }));

function eventTarget() {
  const listeners = new Map<string, Set<(event: any) => void>>();
  return {
    addEventListener(type: string, listener: (event: any) => void) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type)!.add(listener);
    },
    removeEventListener(type: string, listener: (event: any) => void) {
      listeners.get(type)?.delete(listener);
    },
    emit(type: string, event: object = {}) {
      listeners.get(type)?.forEach((listener) => listener({ type, ...event }));
    },
  };
}

describe('Electron history pagination', () => {
  let renderer: ReactTestRenderer;
  let owner: ReturnType<typeof eventTarget>;
  let node: ReturnType<typeof eventTarget> & {
    ownerDocument: typeof owner;
    scrollTop: number;
    scrollHeight: number;
    clientHeight: number;
  };
  let callback: jest.Mock;
  let listRef: { current: { getScrollableNode: () => typeof node } };

  function Harness({ mounted = true }: { mounted?: boolean }) {
    useElectronHistoryPagination({ listRef, mounted, onHistoryEdge: callback });
    return null;
  }

  beforeEach(() => {
    jest.useFakeTimers();
    owner = eventTarget();
    node = { ...eventTarget(), ownerDocument: owner, scrollTop: 3200, scrollHeight: 4000, clientHeight: 800 };
    callback = jest.fn();
    listRef = { current: { getScrollableNode: () => node } };
    act(() => { renderer = create(<Harness />); });
  });

  afterEach(() => {
    act(() => renderer.unmount());
    jest.useRealTimers();
  });

  it('loads successive pages from wheel/trackpad input without native gesture callbacks', () => {
    for (let page = 0; page < 3; page++) {
      act(() => {
        node.emit('wheel', { deltaY: -100 });
        jest.runOnlyPendingTimers();
      });
    }
    expect(callback).toHaveBeenCalledTimes(3);
  });

  it('ignores programmatic scroll and content changes after a consumed input', () => {
    act(() => {
      node.emit('wheel', { deltaY: -100 });
      jest.runOnlyPendingTimers();
      node.scrollHeight += 1000;
      node.emit('scroll');
      jest.runOnlyPendingTimers();
    });
    expect(callback).toHaveBeenCalledTimes(1);
  });

  it('checks the final scrollbar position and stops listening after release', () => {
    act(() => {
      node.emit('pointerdown', { button: 0, target: node });
      owner.emit('pointermove', { buttons: 1 });
      owner.emit('pointerup');
      jest.runOnlyPendingTimers();
      owner.emit('pointermove', { buttons: 1 });
      node.emit('scroll');
      jest.runOnlyPendingTimers();
    });
    expect(callback).toHaveBeenCalledTimes(1);
  });

  it('ignores bubble clicks, zoom, horizontal input and scrolling away from history', () => {
    act(() => {
      node.emit('pointerdown', { button: 0, target: {} });
      owner.emit('pointermove', { buttons: 1 });
      node.emit('wheel', { deltaY: 100, ctrlKey: true });
      node.emit('wheel', { deltaY: 0 });
      jest.runOnlyPendingTimers();
      node.scrollTop = 0;
      node.emit('wheel', { deltaY: -10 });
      jest.runOnlyPendingTimers();
    });
    expect(callback).not.toHaveBeenCalled();
  });

  it('cleans up queued work and reattaches when the focus cover releases the list', () => {
    act(() => {
      node.emit('wheel', { deltaY: -100 });
      renderer.update(<Harness mounted={false} />);
    });
    act(() => { jest.runOnlyPendingTimers(); });
    expect(callback).not.toHaveBeenCalled();
    act(() => { renderer.update(<Harness />); });
    act(() => {
      node.emit('wheel', { deltaY: -100 });
      jest.runOnlyPendingTimers();
    });
    expect(callback).toHaveBeenCalledTimes(1);
  });
});
