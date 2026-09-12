import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const require = createRequire(import.meta.url);
const decode = require('decode-uri-component');
const queryString = require('query-string');
const imageSize = require('image-size');
const root = fileURLToPath(new URL('../', import.meta.url));

// A missing patch must fail the test rather than hang the test runner or CI.
function bounded(source) {
  const result = spawnSync(process.execPath, ['--max-old-space-size=128', '-e', source], { cwd: root, timeout: 3000, encoding: 'utf8' });
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stderr);
}

function box(type, payload = Buffer.alloc(0), declaredSize = payload.length + 8) {
  const header = Buffer.alloc(8);
  header.writeUInt32BE(declaredSize);
  header.write(type, 4, 'ascii');
  return Buffer.concat([header, payload]);
}

function icns(...entries) {
  const header = Buffer.alloc(8);
  header.write('icns');
  header.writeUInt32BE(8 + entries.reduce((total, entry) => total + entry.length, 0), 4);
  return Buffer.concat([header, ...entries]);
}

function icon(type, size = 8) {
  const entry = Buffer.alloc(8);
  entry.write(type);
  entry.writeUInt32BE(size, 4);
  return entry;
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

test('ICNS reads valid icon entries and rejects invalid entry lengths without looping', () => {
  const valid = imageSize(icns(icon('icp4'), icon('icp5')));
  assert.equal(valid.width, 16);
  assert.deepEqual(valid.images.map(({ width }) => width), [16, 32]);
  const malformed = [
    icns(icon('icp4', 0)),
    ...[0, 1, 7, 100].map((size) => icns(icon('icp4'), icon('icp5', size))),
    icns(icon('icp4'), Buffer.alloc(4)),
  ].map((buffer) => buffer.toString('base64'));
  bounded(`
    const assert = require('node:assert/strict');
    const imageSize = require('image-size');
    for (const fixture of ${JSON.stringify(malformed)}) {
      assert.throws(() => imageSize(Buffer.from(fixture, 'base64')));
    }
  `);
});

test('HEIF and JXL reject malformed boxes without looping', () => {
  const heif = box('ftyp', Buffer.from('heic0000'));
  const jxl = Buffer.concat([box('JXL ', Buffer.from([13, 10, 135, 10])), box('ftyp', Buffer.from('jxl 0000'))]);
  const malformed = [
    Buffer.concat([heif, box('meta', Buffer.alloc(4), 0)]),
    Buffer.concat([jxl, box('jxlp', Buffer.alloc(4), 0)]),
    Buffer.concat([jxl, box('jxlp', Buffer.alloc(4), 1)]),
    Buffer.concat([jxl, box('jxlp', Buffer.alloc(4), 7)]),
    Buffer.concat([jxl, box('jxlp', Buffer.alloc(4), 100)]),
  ].map((buffer) => buffer.toString('base64'));
  bounded(`
    const assert = require('node:assert/strict');
    const imageSize = require('image-size');
    for (const fixture of ${JSON.stringify(malformed)}) {
      assert.throws(() => imageSize(Buffer.from(fixture, 'base64')));
    }
  `);
});

test('valid HEIF dimensions, including a final size-zero box, remain readable', () => {
  const dimensions = Buffer.alloc(12);
  dimensions.writeUInt32BE(640, 4);
  dimensions.writeUInt32BE(480, 8);
  for (const size of [20, 0]) {
    const properties = box('iprp', box('ipco', box('ispe', dimensions, size)));
    const input = Buffer.concat([box('ftyp', Buffer.from('heic0000')), box('meta', Buffer.concat([Buffer.alloc(4), properties]))]);
    assert.deepEqual(imageSize(input), { width: 640, height: 480, type: 'heic' });
  }
});

test('valid JXL codestream and partial-stream containers remain readable', () => {
  // Minimal size header: small image, height 8, square aspect ratio.
  const stream = Buffer.from([0xff, 0x0a, 0x41, 0]);
  const header = Buffer.concat([box('JXL ', Buffer.from([13, 10, 135, 10])), box('ftyp', Buffer.from('jxl 0000'))]);
  const first = box('jxlp', Buffer.concat([Buffer.alloc(4), stream.subarray(0, 2)]));
  const lastPayload = Buffer.concat([Buffer.from([0x80, 0, 0, 1]), stream.subarray(2)]);
  const containers = [
    box('jxlc', stream),
    Buffer.concat([first, box('jxlp', lastPayload)]),
    Buffer.concat([first, box('jxlp', lastPayload, 0)]),
  ];
  for (const container of containers) {
    assert.deepEqual(imageSize(Buffer.concat([header, container])), { width: 8, height: 8, type: 'jxl' });
  }
});
