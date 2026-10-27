import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { webcrypto } from 'node:crypto';
import vm from 'node:vm';

const generated = readFileSync('src/lib/napp/bootstrap.generated.ts', 'utf8');
const source = JSON.parse(generated.split('export const nappBootstrap = ')[1].trim().slice(0, -1));

for (const outbox of [false, true]) test(`shipped ${outbox ? 'outbox' : 'relay'} bridge streams events before independent EOSE notifications`, () => {
  const requests = [];
  const window = {
    __exploreDocumentCommitted: true,
    Notification: class {},
    __psstExplore: { post(raw) {
      const request = JSON.parse(raw); requests.push(request);
      window.__exploreReceive({ id: request.id, nonce: request.nonce, result: true });
    } },
  };
  window.top = window;
  const context = vm.createContext({
    window, document: { execCommand() {}, addEventListener() {} }, navigator: {},
    crypto: webcrypto, addEventListener() {}, requestAnimationFrame() {},
    setTimeout, clearTimeout, console, URL, EventTarget, WeakRef,
  });
  vm.runInContext(source + ';PsstNappBootstrap.install({napp:true,domains:[]});', context);
  const delivered = [], completions = [], batches = [];
  const options = { liveEventCallback: event => delivered.push(event), eoseCallback: url => completions.push(url), eoseEventsCallback: events => batches.push(events) };
  const subscription = outbox
    ? window.napp.outbox({ authors: ['a'.repeat(64)] }, options)
    : window.napp.utils.subscribe(['wss://fast.example/', 'wss://slow.example/'], { kinds: [1] }, options);
  const request = requests.at(-1);
  assert.equal(request.method, outbox ? 'outboxSubscribe' : 'relaySubscribe');
  const send = message => window.__exploreReceive({ type: 'stream', nonce: request.nonce, streamId: request.args[0], ...message });
  // Exceed the removed initial-batch cap without any relay finishing its read.
  for (let index = 0; index < 1200; index++) {
    send({ phase: 'event', event: { id: String(index) } });
    assert.equal(delivered.length, index + 1);
  }
  assert.deepEqual(completions, []);
  send({ phase: 'eose', url: 'wss://fast.example/' });
  assert.deepEqual(completions, ['wss://fast.example/']);
  send({ phase: 'event', event: { id: 'slow-event' } });
  send({ phase: 'eose', url: 'wss://slow.example/' });
  assert.equal(delivered.at(-1).id, 'slow-event');
  assert.deepEqual(completions, ['wss://fast.example/', 'wss://slow.example/']);
  assert.deepEqual(batches, []);
  if (outbox) subscription.close(); else subscription();
  send({ phase: 'event', event: { id: 'after-close' } });
  assert.equal(delivered.length, 1201);
  assert.equal(requests.at(-1).method, 'streamClose');
});
