import { RelayBudget } from '../relay-budget';

it('reclaims idle destinations after reading more authors than the connection-cache size', () => {
  const evict = jest.fn(), budget = new RelayBudget(evict);
  const pinned = budget.tryAcquire(['wss://live.example/'])!;
  for (let index = 0; index < 100; index++) {
    const release = budget.tryAcquire([`wss://author-${index}.example/`]);
    expect(release).toEqual(expect.any(Function)); release!();
  }
  expect(evict).toHaveBeenCalled();
  expect(evict.mock.calls.flatMap(([urls]) => urls)).not.toContain('wss://live.example/');
  pinned(); budget.close();
});

it('keeps a shared relay active until its last consumer releases it', () => {
  const evict = jest.fn(), budget = new RelayBudget(evict, 1);
  const first = budget.tryAcquire(['wss://shared.example'])!, second = budget.tryAcquire(['wss://shared.example/'])!;
  first(); first();
  expect(budget.tryAcquire(['wss://other.example/'])).toBeUndefined();
  second();
  const release = budget.tryAcquire(['wss://other.example/'])!;
  expect(evict).toHaveBeenCalledWith(['wss://shared.example/']);
  release(); budget.close();
});

it('waits for active capacity and removes cancelled waiters', async () => {
  const budget = new RelayBudget(jest.fn(), 1), first = budget.tryAcquire(['wss://first.example/'])!;
  const cancelled = new AbortController();
  const denied = expect(budget.acquire(['wss://cancelled.example/'], cancelled.signal, 1000)).rejects.toThrow('session-closed');
  cancelled.abort(); await denied;
  const waiting = budget.acquire(['wss://next.example/'], new AbortController().signal, 1000);
  first();
  const release = await waiting;
  expect(budget.tryAcquire(['wss://third.example/'])).toBeUndefined();
  release(); budget.close();
});
