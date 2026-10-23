import { IncBroker } from '../inc';

test('INC never crosses accounts and sender identity is runtime-attested', async () => {
  const broker = new IncBroker();
  const a = jest.fn(),
    b = jest.fn(),
    other = jest.fn();
  broker.attach('A1', 'accountA', a);
  broker.attach('A2', 'accountA', b);
  broker.attach('B1', 'accountB', other);
  await broker.handle('A2', { type: 'inc.subscribe', topic: 'updates', id: '1' }, async () => {});
  await broker.handle('B1', { type: 'inc.subscribe', topic: 'updates', id: '2' }, async () => {});
  b.mockClear();
  other.mockClear();
  await broker.handle(
    'A1',
    { type: 'inc.emit', topic: 'updates', sender: 'B1', payload: 'data' },
    async () => {},
  );
  expect(b).toHaveBeenCalledWith({
    type: 'inc.event',
    topic: 'updates',
    sender: 'A1',
    payload: 'data',
  });
  expect(other).not.toHaveBeenCalled();
  await expect(
    broker.handle('A1', { type: 'inc.channel.open', target: 'B1', id: '3' }, async () => {}),
  ).rejects.toThrow('peer-unavailable');
});
test('channel opening, delivery and teardown are bound to live endpoints', async () => {
  const broker = new IncBroker();
  const a = jest.fn(),
    b = jest.fn();
  const detach = broker.attach('A1', 'account', a);
  broker.attach('A2', 'account', b);
  await broker.handle('A1', { type: 'inc.channel.open', target: 'A2', id: 'open' }, async () => {});
  const channelId = a.mock.calls[0][0].channelId;
  expect(b.mock.calls[0][0]).toEqual({ type: 'inc.channel.opened', channelId, peer: 'A1' });
  await broker.handle(
    'A1',
    { type: 'inc.channel.emit', channelId, payload: 'message' },
    async () => {},
  );
  expect(b).toHaveBeenLastCalledWith({
    type: 'inc.channel.event',
    channelId,
    sender: 'A1',
    payload: 'message',
  });
  detach();
  expect(b).toHaveBeenLastCalledWith({
    type: 'inc.channel.closed',
    channelId,
    reason: 'endpoint-closed',
  });
  await expect(
    broker.handle('A2', { type: 'inc.channel.emit', channelId }, async () => {}),
  ).rejects.toThrow();
});
test('an endpoint removed during consent cannot acquire a channel', async () => {
  const broker = new IncBroker();
  broker.attach('source', 'account', jest.fn());
  const detach = broker.attach('target', 'account', jest.fn());
  await expect(
    broker.handle('source', { type: 'inc.channel.open', target: 'target', id: '1' }, async () => {
      detach();
    }),
  ).rejects.toThrow('endpoint-closed');
});
