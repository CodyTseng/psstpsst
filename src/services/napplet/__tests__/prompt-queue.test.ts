import { PromptQueue, type QueuedPrompt } from '../prompt-queue';

beforeEach(() => jest.useFakeTimers());
afterEach(() => jest.useRealTimers());

function setup() {
  let visible: QueuedPrompt | null = null;
  const queue = new PromptQueue((value) => { visible = value; });
  return { queue, current: () => visible };
}
const prompt = { title: 'App', detail: 'Publish a post' };

test('serializes requests and ignores answers from an obsolete dialog', async () => {
  const { queue, current } = setup();
  const first = queue.ask(prompt);
  const oldId = current()!.requestId;
  const second = queue.ask(prompt);
  expect(current()!.queued).toBe(1);
  queue.answer(oldId, 'allow');
  await expect(first).resolves.toBe('allow');
  const newId = current()!.requestId;
  queue.answer(oldId, 'allow-always');
  expect(current()!.requestId).toBe(newId);
  queue.answer(newId, false);
  await expect(second).resolves.toBe(false);
  expect(current()).toBeNull();
});

test('each request receives 25 seconds only when it reaches the front', async () => {
  const { queue, current } = setup();
  const first = queue.ask(prompt);
  const firstDeadline = current()!.expiresAt;
  jest.advanceTimersByTime(10000);
  const second = queue.ask(prompt);
  expect(current()!.expiresAt).toBe(firstDeadline);
  expect(current()!.queued).toBe(1);
  jest.advanceTimersByTime(15000);
  await expect(first).resolves.toBe(false);
  expect(current()!.expiresAt).toBe(Date.now() + 25000);
  expect(current()!.queued).toBe(0);
  jest.advanceTimersByTime(24999);
  expect(current()).not.toBeNull();
  queue.answer(current()!.requestId, 'allow');
  await expect(second).resolves.toBe('allow');
});

test('a queued request that becomes visible after a long wait still has its full review time', async () => {
  const { queue, current } = setup();
  const first = queue.ask(prompt);
  const second = queue.ask(prompt);
  jest.setSystemTime(Date.now() + 60000);
  queue.answer(current()!.requestId, 'allow-always');
  await expect(first).resolves.toBe(false);
  expect(current()!.expiresAt).toBe(Date.now() + 25000);
  queue.answer(current()!.requestId, 'allow');
  await expect(second).resolves.toBe('allow');
});

test('account/session cancellation rejects active and queued requests', async () => {
  const { queue, current } = setup();
  const abort = new AbortController();
  const first = queue.ask(prompt, abort.signal);
  const second = queue.ask(prompt, abort.signal);
  abort.abort();
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

test('sharing defers background approval presentation and starts a fresh review on return', async () => {
  const { queue, current } = setup();
  queue.setPaused(true);
  const pending = queue.ask(prompt);
  const settled = jest.fn(); void pending.then(settled);
  await jest.advanceTimersByTimeAsync(60000);
  expect(current()).toBeNull(); expect(settled).not.toHaveBeenCalled();
  queue.setPaused(false);
  expect(current()!.expiresAt).toBe(Date.now() + 25000);
  queue.answer(current()!.requestId, 'allow');
  await expect(pending).resolves.toBe('allow');
});
