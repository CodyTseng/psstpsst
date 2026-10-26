import { SendingOnClosedConnection } from 'nostr-tools/abstract-relay';
import { LifecycleRelay } from '../lifecycle-relay';

class Socket {
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;
  static latest: Socket;
  readyState = 0;
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onerror = null;
  send = jest.fn((_message: string) => {
    if (this.readyState !== Socket.OPEN) throw new Error('write after close');
  });
  constructor() { Socket.latest = this; }
  close() { this.readyState = Socket.CLOSING; }
}

beforeEach(() => { jest.useFakeTimers(); });
afterEach(() => { jest.clearAllTimers(); jest.useRealTimers(); });

async function connectedRelay() {
  const relay = new LifecycleRelay('wss://relay.example/', {
    verifyEvent: () => true,
    websocketImplementation: Socket as unknown as typeof WebSocket,
  });
  const connecting = relay.connect();
  Socket.latest.readyState = Socket.OPEN;
  Socket.latest.onopen!();
  await connecting;
  return relay;
}

it('finishes queued subscription cleanup before closing the socket', async () => {
  const relay = await connectedRelay();
  const socket = Socket.latest;
  const first = relay.subscribe([{ kinds: [1] }], { id: 'first' });
  relay.subscribe([{ kinds: [0] }], { id: 'second' });
  first.close();
  relay.close();
  await Promise.resolve();
  expect(socket.send.mock.calls.map((args) => JSON.parse(args[0] as string).slice(0, 2))).toEqual([
    ['REQ', 'first'], ['REQ', 'second'], ['CLOSE', 'first'], ['CLOSE', 'second'],
  ]);
  expect(socket.readyState).toBe(Socket.CLOSING);
});

it('skips cleanup frames after peer closure but rejects new writes', async () => {
  const relay = await connectedRelay();
  const socket = Socket.latest;
  socket.readyState = Socket.CLOSING;
  await expect(relay.send('["CLOSE","first"]')).resolves.toBeUndefined();
  await expect(relay.send('["EVENT",{}]')).rejects.toBeInstanceOf(SendingOnClosedConnection);
  expect(socket.send).not.toHaveBeenCalled();
  relay.close();
});

it('retires a closing socket after subscribe returns instead of rejecting an unobserved promise', async () => {
  const relay = await connectedRelay();
  const socket = Socket.latest;
  const onclose = jest.fn();
  relay.onclose = onclose;
  socket.readyState = Socket.CLOSING;
  const subscription = relay.subscribe([{ kinds: [1059] }], { id: 'history', onclose: jest.fn() });
  expect(relay.openSubs.has(subscription.id)).toBe(true);
  jest.runAllTicks();
  await Promise.resolve();
  expect(relay.connected).toBe(false);
  expect(relay.openSubs.size).toBe(0);
  expect(subscription.onclose).toHaveBeenCalledTimes(1);
  expect(onclose).toHaveBeenCalledTimes(1);
  expect(socket.send).not.toHaveBeenCalled();
});

it('recovers from synchronous subscription write failures on an apparently open socket', async () => {
  const relay = await connectedRelay();
  Socket.latest.send.mockImplementation(() => { throw new Error('socket write failed'); });
  const onclose = jest.fn();
  relay.onclose = onclose;
  relay.subscribe([{ kinds: [1] }], { id: 'write-failure' });
  jest.runAllTicks();
  await Promise.resolve();
  expect(relay.connected).toBe(false);
  expect(onclose).toHaveBeenCalledTimes(1);
  expect(relay.openSubs.size).toBe(0);
});

it('handles failed AUTH frames without an unobserved rejection', async () => {
  const relay = await connectedRelay();
  Socket.latest.readyState = Socket.CLOSING;
  await expect(relay.send('["AUTH",{}]')).resolves.toBeUndefined();
  jest.runAllTicks();
  expect(relay.connected).toBe(false);
});
