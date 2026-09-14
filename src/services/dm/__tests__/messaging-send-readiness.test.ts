import {
  beginMessagingSendPreparation,
  cancelMessagingSendPreparation,
  completeMessagingSendPreparation,
  failMessagingSendPreparation,
  waitForMessagingSendReadiness,
} from '../messaging-send-readiness';

afterEach(() => cancelMessagingSendPreparation());

it('keeps sends pending until startup completes', async () => {
  beginMessagingSendPreparation('account');
  let settled = false;
  const waiting = waitForMessagingSendReadiness('account').then(() => { settled = true; });

  await Promise.resolve();
  expect(settled).toBe(false);

  completeMessagingSendPreparation('account');
  await waiting;
  expect(settled).toBe(true);
});

it('releases every send queued for the same startup', async () => {
  beginMessagingSendPreparation('account');
  const waiting = [
    waitForMessagingSendReadiness('account'),
    waitForMessagingSendReadiness('account'),
  ];

  completeMessagingSendPreparation('account');
  await expect(Promise.all(waiting)).resolves.toEqual([undefined, undefined]);
});

it('rejects queued sends when preparation fails', async () => {
  beginMessagingSendPreparation('account');
  const waiting = waitForMessagingSendReadiness('account');

  failMessagingSendPreparation('account', new Error('Signer rejected the request.'));
  await expect(waiting).rejects.toThrow('Signer rejected the request.');
});

it('cancels stale sends when the active account changes', async () => {
  beginMessagingSendPreparation('first');
  const waiting = waitForMessagingSendReadiness('first');

  beginMessagingSendPreparation('second');
  await expect(waiting).rejects.toThrow('active account changed');
});
