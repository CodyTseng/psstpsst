import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const require = createRequire(import.meta.url);
const decode = require('decode-uri-component');
const queryString = require('query-string');
const root = fileURLToPath(new URL('../', import.meta.url));

// A missing patch must fail the test rather than hang the test runner or CI.
function bounded(source) {
  const result = spawnSync(process.execPath, ['--max-old-space-size=128', '-e', source], { cwd: root, timeout: 3000, encoding: 'utf8' });
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stderr);
}

test('URI decoding preserves query-string behavior and valid UTF-8', () => {
  assert.equal(decode('hello+world'), 'hello world');
  assert.equal(decode('%E4%BD%A0%E5%A5%BD%20%F0%9F%98%80'), '你好 😀');
  assert.equal(decode('%25E4'), '%E4');
  assert.equal(decode('%25C2%FF'), '%C2%FF');
  assert.equal(decode('%C2'), '\uFFFD');
  assert.equal(decode('%FE%FF'), '\uFFFD\uFFFD');
  assert.equal(decode('%FF%41%E2%82%AC%'), '%FFA€%');
  assert.throws(() => decode(null), TypeError);
  assert.deepEqual({ ...queryString.parse('q=hello+world&tag=%E4%BD%A0&tag=%F0%9F%98%80&empty=&flag') }, {
    empty: '', flag: null, q: 'hello world', tag: ['你', '😀'],
  });
});

test('malformed percent-encoded URLs finish within a bounded time', () => {
  bounded(`
    const assert = require('node:assert/strict');
    const queryString = require('query-string');
    const input = '%FF'.repeat(20000) + '%41';
    assert.equal(queryString.parse('q=' + input).q, '%FF'.repeat(20000) + 'A');
    const runs = Array.from({ length: 10000 }, (_, index) => '%FF%41' + index).join('-');
    assert.equal(queryString.parse('q=' + runs).q, runs.replace(/%41/g, 'A'));
  `);
});
