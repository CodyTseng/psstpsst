import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';

const require = createRequire(import.meta.url);
const packageRoot = path.dirname(require.resolve('react-native-web/package.json'));
const implementations = [
  'src/vendor/react-native/VirtualizedList/index.js',
  'dist/vendor/react-native/VirtualizedList/index.js',
  'dist/cjs/vendor/react-native/VirtualizedList/index.js',
];

for (const implementation of implementations) {
  const source = readFileSync(path.join(packageRoot, implementation), 'utf8');
  // Exercise the dependency's actual handler without booting a DOM or renderer.
  // Both published builds and the Flow source use this self-contained callback.
  const handler = source.match(/(?:this\.)?invertedWheelEventHandler = (?:\([^)]*\)|\w+) => \{([\s\S]*?)\n\s{4}\};/);
  assert.ok(handler, `Missing inverted wheel handler in ${implementation}`);
  const body = handler[1].replaceAll('(this._scrollRef: any)', 'this._scrollRef');
  const wheel = vm.runInNewContext(`(function(ev) {${body}\n})`);

  function scroll({ offset = 6000, delta = 40, measured = 1200, length = 20000, viewport = 800, targetRoot = false, expectPrevented = true } = {}) {
    const node = { scrollTop: offset, scrollLeft: offset, scrollHeight: length, scrollWidth: length, clientHeight: viewport, clientWidth: viewport };
    const event = {
      // A wheel gesture over a message bubbles to the inverted list.
      target: targetRoot ? node : { scrollTop: 0, scrollLeft: 0, scrollHeight: 0, scrollWidth: 0, clientHeight: 0, clientWidth: 0 },
      deltaY: delta, deltaX: delta, prevented: false,
      preventDefault() { this.prevented = true; },
    };
    wheel.call({ props: { inverted: true, horizontal: false }, _totalCellLength: measured, _scrollRef: { getScrollableNode: () => node } }, event);
    assert.equal(event.prevented, expectPrevented);
    return node.scrollTop;
  }

  test(`${implementation}: a small gesture toward newer messages never snaps to measured height`, () => {
    assert.equal(scroll(), 5960);
    assert.equal(scroll({ measured: 0 }), 5960);
  });
  test(`${implementation}: scrolling older follows the gesture and respects the real edge`, () => {
    assert.equal(scroll({ delta: -40 }), 6040);
    assert.equal(scroll({ offset: 19190, delta: -40 }), 19200);
    assert.equal(scroll({ offset: 10, delta: 40 }), 0);
  });
  test(`${implementation}: scrolling over the list background has the same direction as over a message`, () => {
    assert.equal(scroll({ targetRoot: true, delta: 40 }), 5960);
    assert.equal(scroll({ targetRoot: true, delta: -40 }), 6040);
  });
  test(`${implementation}: a horizontal-only gesture cannot reset vertical scroll`, () => {
    assert.equal(scroll({ delta: 0, expectPrevented: false }), 6000);
  });
  test(`${implementation}: short histories do not produce a negative offset`, () => {
    assert.equal(scroll({ offset: 0, length: 500, delta: -40 }), 0);
  });
}
