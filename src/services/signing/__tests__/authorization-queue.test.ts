import { queueAuthorization } from '../authorization-queue';

const scope = { accountPubkey: 'account', sourceId: 'https://app.example' };

test('canceling the active request notifies its caller but waits for processing to finish', async () => {
  const life = new AbortController();
  let finish!: () => void;
  const first = queueAuthorization(scope, [life.signal], () => new Promise<void>(resolve => { finish = resolve; }));
  await Promise.resolve();
  const canceled = expect(first).rejects.toMatchObject({ name: 'AbortError' });
  life.abort(); await canceled;
  const run = jest.fn(async () => 'next');
  const next = queueAuthorization(scope, [], run);
  await new Promise(resolve => setTimeout(resolve, 0));
  expect(run).not.toHaveBeenCalled();
  finish();
  await expect(next).resolves.toBe('next');
});

test('canceling B cannot let C or a later arrival pass the still-running A', async () => {
  const order: string[] = [];
  let finishA!: () => void;
  const a = queueAuthorization(scope, [], () => new Promise<void>(resolve => { order.push('A'); finishA = resolve; }));
  const lifeB = new AbortController(), runB = jest.fn(async () => { order.push('B'); });
  const b = queueAuthorization(scope, [lifeB.signal], runB);
  const c = queueAuthorization(scope, [], async () => { order.push('C'); });
  const canceled = expect(b).rejects.toMatchObject({ name: 'AbortError' });
  lifeB.abort(); await canceled;
  const d = queueAuthorization(scope, [], async () => { order.push('D'); });
  await new Promise(resolve => setTimeout(resolve, 0));
  expect(order).toEqual(['A']);
  finishA(); await Promise.all([a, c, d]);
  expect(order).toEqual(['A', 'C', 'D']);
  expect(runB).not.toHaveBeenCalled();
});

test('a canceled queued authorization never reaches its permission provider', async () => {
  let finish!: () => void;
  const first = queueAuthorization(scope, [], () => new Promise<void>(resolve => { finish = resolve; }));
  const life = new AbortController(), run = jest.fn(async () => {});
  const second = queueAuthorization(scope, [life.signal], run);
  const canceled = expect(second).rejects.toMatchObject({ name: 'AbortError' });
  life.abort(); await canceled;
  await Promise.resolve(); finish(); await first;
  await queueAuthorization(scope, [], async () => {});
  expect(run).not.toHaveBeenCalled();
});

test('waiting for one source never blocks a different application or account', async () => {
  let finish!: () => void;
  const first = queueAuthorization(scope, [], () => new Promise<void>(resolve => { finish = resolve; }));
  await expect(queueAuthorization({ ...scope, sourceId: 'https://other.example' }, [], async () => 'other app')).resolves.toBe('other app');
  await expect(queueAuthorization({ ...scope, accountPubkey: 'other' }, [], async () => 'other account')).resolves.toBe('other account');
  finish(); await first;
});

test('failure of the current request still releases the next queue entry', async () => {
  const first = queueAuthorization(scope, [], async () => { throw new Error('failed'); });
  const next = queueAuthorization(scope, [], async () => 'next');
  await expect(first).rejects.toThrow('failed');
  await expect(next).resolves.toBe('next');
});
