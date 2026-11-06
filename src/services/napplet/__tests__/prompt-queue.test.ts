import { PromptQueue, type QueuedPrompt } from '../prompt-queue';

beforeEach(() => jest.useFakeTimers());
afterEach(() => jest.useRealTimers());

function setup() {
  let visible: QueuedPrompt | null = null;
  const queue = new PromptQueue((value) => { visible = value; });
  return { queue, current: () => visible };
}
const prompt = { title: 'App', detail: 'Publish a post' };
const chooser = { title: 'App', detail: '', choices: [{ key: 'target', title: 'Target' }],
  applicationSelection: { requester: 'App', content: 'content' as const } };

test.each([prompt, chooser])('keeps $title requests open until a decision and dismissal', async request => {
  const { queue, current } = setup();
  const pending = queue.ask(request);
  const settled = jest.fn();
  void pending.then(settled);
  const id = current()!.requestId;
  await jest.advanceTimersByTimeAsync(10 * 60000);
  expect(current()!.requestId).toBe(id);
  expect(settled).not.toHaveBeenCalled();
  queue.answer(id, 'target');
  expect(current()).toBeNull();
  await Promise.resolve();
  expect(settled).not.toHaveBeenCalled();
  queue.dismissed();
  await expect(pending).resolves.toBe('target');
});

test('keeps the next approval available after a long wait behind a chooser', async () => {
  const { queue, current } = setup();
  const selection = queue.ask(chooser);
  const approval = queue.ask(prompt);
  await jest.advanceTimersByTimeAsync(2 * 60000);
  queue.answer(current()!.requestId, false);
  queue.dismissed();
  await expect(selection).resolves.toBe(false);
  expect(current()!.title).toBe(prompt.title);
  queue.answer(current()!.requestId, 'allow');
  queue.dismissed();
  await expect(approval).resolves.toBe('allow');
});

test('requester cancellation still closes an untimed chooser', async () => {
  const { queue, current } = setup();
  const abort = new AbortController();
  const pending = queue.ask(chooser, abort.signal);
  abort.abort();
  expect(current()).toBeNull();
  queue.dismissed();
  await expect(pending).resolves.toBe(false);
});

test('closes the sheet before settling its decision or presenting another request', async () => {
  const { queue, current } = setup();
  const first = queue.ask(prompt), settled = jest.fn();
  void first.then(settled);
  const second = queue.ask(prompt);
  queue.answer(current()!.requestId, 'allow-always');
  expect(current()).toBeNull();
  await Promise.resolve();
  expect(settled).not.toHaveBeenCalled();
  queue.dismissed();
  await expect(first).resolves.toBe('allow-always');
  expect(current()).not.toBeNull();
  queue.cancelAll();
  await expect(second).resolves.toBe(false);
});

test('session cancellation discards a decision whose sheet is still closing', async () => {
  const { queue, current } = setup();
  const first = queue.ask(prompt);
  queue.answer(current()!.requestId, 'allow-always');
  queue.cancelAll(); queue.dismissed();
  await expect(first).resolves.toBe(false);
  expect(current()).toBeNull();
});

test('serializes requests and ignores answers from an obsolete dialog', async () => {
  const { queue, current } = setup();
  const first = queue.ask(prompt);
  const oldId = current()!.requestId;
  const second = queue.ask(prompt);
  expect(current()!.queued).toBe(1);
  queue.answer(oldId, 'allow');
  queue.dismissed();
  await expect(first).resolves.toBe('allow');
  const newId = current()!.requestId;
  queue.answer(oldId, 'allow-always');
  queue.dismissed();
  expect(current()!.requestId).toBe(newId);
  queue.answer(newId, false);
  queue.dismissed();
  await expect(second).resolves.toBe(false);
  expect(current()).toBeNull();
});

test('active and queued approvals remain answerable after long waits and suspension', async () => {
  const { queue, current } = setup();
  const first = queue.ask(prompt);
  const firstId = current()!.requestId;
  const second = queue.ask(prompt);
  await jest.advanceTimersByTimeAsync(60 * 60000);
  expect(current()!.requestId).toBe(firstId);
  expect(current()!.queued).toBe(1);
  expect(jest.getTimerCount()).toBe(0);
  queue.answer(firstId, 'allow-always');
  queue.dismissed();
  await expect(first).resolves.toBe('allow-always');
  jest.setSystemTime(Date.now() + 24 * 60 * 60000);
  queue.answer(current()!.requestId, 'allow');
  queue.dismissed();
  await expect(second).resolves.toBe('allow');
});

test('account/session cancellation rejects active and queued requests', async () => {
  const { queue, current } = setup();
  const abort = new AbortController();
  const first = queue.ask(prompt, abort.signal);
  const second = queue.ask(prompt, abort.signal);
  abort.abort();
  queue.dismissed();
  await expect(first).resolves.toBe(false);
  await expect(second).resolves.toBe(false);
  expect(current()).toBeNull();
});

test('bounds pending approvals and supports rejecting the entire queue', async () => {
  const { queue, current } = setup();
  const requests = Array.from({ length: 16 }, () => queue.ask(prompt));
  await expect(queue.ask(prompt)).rejects.toThrow('quota-exceeded');
  queue.cancelAll();
  expect(await Promise.all(requests)).toEqual(Array(16).fill(false));
  expect(current()).toBeNull();
});

test('reject-all pauses a noisy app until the cooldown or execution session ends', async () => {
  const { queue, current } = setup();
  const pending = queue.ask(prompt);
  queue.rejectAll();
  await expect(pending).resolves.toBe(false);
  await expect(queue.ask(prompt)).resolves.toBe(false);
  expect(current()).toBeNull();
  jest.advanceTimersByTime(60000);
  const next = queue.ask(prompt);
  expect(current()).not.toBeNull();
  queue.cancelAll();
  await expect(next).resolves.toBe(false);
});

test('sharing defers background approval presentation without imposing a deadline on return', async () => {
  const { queue, current } = setup();
  queue.setPaused(true);
  const pending = queue.ask(prompt);
  const settled = jest.fn(); void pending.then(settled);
  await jest.advanceTimersByTimeAsync(60000);
  expect(current()).toBeNull(); expect(settled).not.toHaveBeenCalled();
  queue.setPaused(false);
  expect(current()!.title).toBe(prompt.title);
  queue.answer(current()!.requestId, 'allow');
  queue.dismissed();
  await expect(pending).resolves.toBe('allow');
});
