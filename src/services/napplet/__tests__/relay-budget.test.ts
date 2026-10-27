import { RelayBudget } from '../relay-budget';

it('retains every requested destination without an active connection quota', () => {
  const evict = jest.fn(), cache = new RelayBudget(evict, 1);
  const urls = Array.from({ length: 100 }, (_, index) => `wss://relay-${index}.example/`);
  const release = cache.retain(urls);
  expect(evict).not.toHaveBeenCalled();
  release();
  expect(evict).toHaveBeenCalledWith(urls.slice(0, 99));
  release(); expect(evict).toHaveBeenCalledTimes(1); cache.close();
});

it('never evicts a shared active relay and reuses recently idle destinations', () => {
  const evict = jest.fn(), cache = new RelayBudget(evict, 1);
  const first = cache.retain(['wss://shared.example']), second = cache.retain(['wss://shared.example/']);
  first();
  const other = cache.retain(['wss://other.example/']);other();
  expect(evict).not.toHaveBeenCalled();
  const reused = cache.retain(['wss://other.example/']);
  second();reused();
  expect(evict).toHaveBeenCalledWith(['wss://shared.example/']);cache.close();
});

it('ignores late releases after shutdown and rejects new work', () => {
  const cache = new RelayBudget(jest.fn());
  const release = cache.retain(['wss://relay.example/']);cache.close();release();
  expect(() => cache.retain(['wss://relay.example/'])).toThrow('session-closed');
});
