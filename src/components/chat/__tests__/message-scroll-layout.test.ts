import { measureMessageScrollOffset, MESSAGE_CELL_ATTRIBUTE } from '../message-scroll-layout';

function root({ targetTop = 80, targetHeight = 200, top = 0, scrollTop = 2071 } = {}) {
  const cell = {
    getAttribute: (name: string) => name === MESSAGE_CELL_ATTRIBUTE ? 'target' : null,
    getBoundingClientRect: () => ({ top: top + targetTop, height: targetHeight }),
  };
  return {
    scrollTop, scrollHeight: 6963, clientHeight: 793,
    getBoundingClientRect: () => ({ top, height: 793 }),
    querySelectorAll: () => [cell],
  };
}

describe('measured inverted message scrolling', () => {
  it('centres actual geometry instead of the stale-frame average from the reported log', () => {
    const node = root();
    const measured = measureMessageScrollOffset(node, 'target', 0.5, 50, 100)!;
    expect(measured.offset).toBe(2262.5);
    const finalTop = 80 + measured.offset - node.scrollTop;
    expect(finalTop + 200 / 2).toBe(50 + (793 - 50 - 100) / 2);
    expect(finalTop).toBeGreaterThanOrEqual(50);
    expect(finalTop + 200).toBeLessThanOrEqual(793 - 100);
    const average = 115.98305084745763;
    const staleEstimate = average * 28 - (793 - average) / 2;
    expect(staleEstimate).toBeCloseTo(2909.0169491525426);
    expect(80 + staleEstimate - node.scrollTop).toBeGreaterThan(793);
  });

  it('moves down toward a target below the visible centre', () => {
    const measured = measureMessageScrollOffset(root({ targetTop: 600 }), 'target', 0.5, 50, 100)!;
    expect(measured.offset).toBe(1742.5);
  });

  it('uses offscreen mounted rows without requiring viewability', () => {
    const measured = measureMessageScrollOffset(root({ targetTop: -200 }), 'target', 0.5, 50, 100)!;
    expect(measured.offset).toBe(2542.5);
  });

  it('uses one coordinate system when the list is below window chrome', () => {
    const measured = measureMessageScrollOffset(root({ top: 150 }), 'target', 0.5, 50, 100)!;
    expect(measured.offset).toBe(2262.5);
  });

  it('shows the beginning of a message taller than the unobscured viewport', () => {
    const node = root({ targetHeight: 900 });
    const measured = measureMessageScrollOffset(node, 'target', 0.5, 50, 100)!;
    expect(80 + measured.offset - node.scrollTop).toBe(50);
  });

  it('clamps to the actual scroll range', () => {
    expect(measureMessageScrollOffset(root({ scrollTop: 10, targetTop: 600 }), 'target', 0.5, 50, 100)?.offset).toBe(0);
    expect(measureMessageScrollOffset(root({ scrollTop: 6000, targetTop: -1000 }), 'target', 0.5, 50, 100)?.offset).toBe(6170);
  });

  it('does not fabricate geometry for absent or unlaid-out targets', () => {
    expect(measureMessageScrollOffset(root(), 'missing', 0.5, 50, 100)).toBeNull();
    expect(measureMessageScrollOffset(root({ targetHeight: 0 }), 'target', 0.5, 50, 100)).toBeNull();
    expect(measureMessageScrollOffset(null, 'target', 0.5, 50, 100)).toBeNull();
  });
});
