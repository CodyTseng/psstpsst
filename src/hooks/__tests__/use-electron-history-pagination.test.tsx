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
  let input: jest.Mock;
  let listRef: { current: { getScrollableNode: () => typeof node } | null };

  function Harness({ mounted = true, windowKey = 'tail' }: { mounted?: boolean; windowKey?: string }) {
    useElectronHistoryPagination({ listRef, mounted, windowKey, onHistoryEdge: callback, onUserInput: input });
    return null;
  }

  beforeEach(() => {
    jest.useFakeTimers();
    owner = eventTarget();
    node = { ...eventTarget(), ownerDocument: owner, scrollTop: 3200, scrollHeight: 4000, clientHeight: 800 };
    callback = jest.fn();
    input = jest.fn();
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

  it('reports deliberate input but ignores automatic scroll events', () => {
    act(() => { node.emit('scroll'); });
    expect(input).not.toHaveBeenCalled();
    act(() => { node.emit('wheel', { deltaY: 80 }); });
    expect(input).toHaveBeenCalledTimes(1);
    act(() => { node.emit('wheel', { deltaY: 0 }); });
    act(() => { node.emit('wheel', { deltaY: 80, ctrlKey: true }); });
    expect(input).toHaveBeenCalledTimes(1);
    act(() => { node.emit('pointerdown', { button: 0, target: node }); });
    expect(input).toHaveBeenCalledTimes(2);
  });

  it.each(['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' '])(
    'uses the shared input and pagination path for %s', key => {
      act(() => { node.emit('keydown', { key }); });
      expect(input).toHaveBeenCalledTimes(1);
      act(() => { jest.runOnlyPendingTimers(); });
      expect(callback).toHaveBeenCalledTimes(1);
    },
  );

  it('ignores typing, action keys, shortcuts, composition, and prevented keyboard events', () => {
    const events = [
      { key: 'a' }, { key: 'Enter' }, { key: 'ArrowDown', defaultPrevented: true },
      { key: 'ArrowDown', ctrlKey: true }, { key: 'ArrowDown', metaKey: true },
      { key: 'ArrowDown', altKey: true }, { key: 'ArrowDown', shiftKey: true },
      { key: 'ArrowDown', isComposing: true },
      { key: 'PageDown', target: { closest: () => ({}) } },
    ];
    act(() => {
      for (const event of events) node.emit('keydown', event);
      // Composer input is outside the list and cannot bubble through its node.
      owner.emit('keydown', { key: 'PageDown' });
      jest.runOnlyPendingTimers();
    });
    expect(input).not.toHaveBeenCalled();
    expect(callback).not.toHaveBeenCalled();
    act(() => { node.emit('keydown', { key: ' ', shiftKey: true, target: { closest: () => null } }); });
    expect(input).toHaveBeenCalledTimes(1);
  });

  it('binds after the FlatList scroll node becomes available', () => {
    act(() => renderer.unmount());
    listRef.current = null;
    act(() => { renderer = create(<Harness />); });
    listRef.current = { getScrollableNode: () => node };
    act(() => { jest.runOnlyPendingTimers(); });

    act(() => {
      node.emit('wheel', { deltaY: -100 });
      jest.runOnlyPendingTimers();
    });
    expect(callback).toHaveBeenCalledTimes(1);
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

  it('rebinds wheel and scrollbar listeners when only the mounted list key changes', () => {
    const previousNode = node;
    const previousOwner = owner;
    act(() => {
      previousNode.emit('keydown', { key: 'PageUp' });
      previousNode.emit('wheel', { deltaY: -100 });
      previousNode.emit('pointerdown', { button: 0, target: previousNode });
      owner = eventTarget();
      node = { ...eventTarget(), ownerDocument: owner, scrollTop: 3200, scrollHeight: 4000, clientHeight: 800 };
      listRef.current = { getScrollableNode: () => node };
      renderer.update(<Harness windowKey="anchor:cached" />);
    });
    act(() => { jest.runOnlyPendingTimers(); });
    expect(callback).not.toHaveBeenCalled();

    input.mockClear();
    act(() => {
      previousNode.emit('keydown', { key: 'PageUp' });
      previousNode.emit('wheel', { deltaY: -100 });
      previousNode.emit('pointerdown', { button: 0, target: previousNode });
      previousOwner.emit('pointermove', { buttons: 1 });
      previousOwner.emit('pointerup');
      jest.runOnlyPendingTimers();
    });
    expect(callback).not.toHaveBeenCalled();

    expect(input).not.toHaveBeenCalled();

    act(() => {
      node.emit('wheel', { deltaY: -100 });
      jest.runOnlyPendingTimers();
    });
    expect(callback).toHaveBeenCalledTimes(1);
    callback.mockClear();
    act(() => {
      node.emit('pointerdown', { button: 0, target: node });
      owner.emit('pointermove', { buttons: 1 });
      owner.emit('pointerup');
      jest.runOnlyPendingTimers();
    });
    expect(callback).toHaveBeenCalledTimes(1);
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
