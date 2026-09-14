import { PendingComposerSends } from '../pending-composer-sends';

it('holds a send until the chat runtime attaches', async () => {
  const queue = new PendingComposerSends();
  const handler = jest.fn();
  let settled = false;
  const sending = (queue.send('hello', []) as Promise<void>).then(() => { settled = true; });

  await Promise.resolve();
  expect(settled).toBe(false);
  expect(handler).not.toHaveBeenCalled();

  queue.attach(handler);
  await sending;
  expect(handler).toHaveBeenCalledWith('hello', []);
});

it('preserves a mounted runtime handler rejection', async () => {
  const queue = new PendingComposerSends();
  const rejection = new Error('Signer rejected the request.');
  queue.attach(() => Promise.reject(rejection));

  await expect(queue.send('hello', [])).rejects.toBe(rejection);
});

it('rejects a queued send if its chat closes before mounting', async () => {
  const queue = new PendingComposerSends();
  const sending = queue.send('hello', []) as Promise<void>;

  queue.cancel(new Error('The chat closed before the message could be sent.'));
  await expect(sending).rejects.toThrow('chat closed');
});
