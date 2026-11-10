import { applicationMessagingReply, unwrapApplicationMessagingReply } from '../application-messaging-reply';

test.each(['session-closed', 'endpoint-closed'] as const)('preserves %s across the IPC result boundary', async reason => {
  const reply = await applicationMessagingReply(async () => { throw new Error(reason); });
  expect(reply).toEqual({ ok: false, error: reason });
  expect(() => unwrapApplicationMessagingReply(reply)).toThrow(new Error(reason));
});

test('does not confuse an action result with the transport envelope', async () => {
  const result = { ok: false, error: 'session-closed' };
  expect(unwrapApplicationMessagingReply(await applicationMessagingReply(async () => result))).toEqual(result);
  expect(unwrapApplicationMessagingReply(await applicationMessagingReply(async () => undefined))).toBeUndefined();
});

test('keeps unexpected handler failures observable', async () => {
  const error = new Error('unexpected-storage-failure');
  await expect(applicationMessagingReply(async () => { throw error; })).rejects.toBe(error);
});
