import { classifyMessageSendFailure } from '../message-send-error';

it.each([
  'DM service not initialized',
  'DM service not initialized for this account',
])('classifies the internal readiness error %j', (reason) => {
  expect(classifyMessageSendFailure(new Error(reason))).toEqual({ kind: 'not_ready' });
});

it('preserves a readable rejection reason', () => {
  expect(classifyMessageSendFailure(new Error('Storage is unavailable'))).toEqual({
    kind: 'reason',
    reason: 'Storage is unavailable',
  });
});

it('falls back when the rejection has no readable reason', () => {
  expect(classifyMessageSendFailure({ code: 'failed' })).toEqual({ kind: 'unknown' });
});
