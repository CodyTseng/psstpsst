import type { Rumor } from '@/db/schema/types';
import { filterNotifiableMessages } from '../notification-filter';
import { takeNotificationEvents } from '../notification-events.service';

jest.mock('../notification-events.service', () => ({ takeNotificationEvents: jest.fn() }));
const take = jest.mocked(takeNotificationEvents);

it('delivers committed events even when the local receiver stored no rumors', async () => {
  const rumor = { id: 'extension-owned' } as Rumor;
  const conversation = { conversationKey: 'peer', deliveryKind: 'relay', groupId: null };
  take.mockResolvedValueOnce({ events: [{ conversation, event: { kind: 'request' }, message: { rumor } }] as never, more: false, throughId: 1 });
  expect(await filterNotifiableMessages([], 'account')).toEqual([{ rumor, kind: 'request', conversation }]);
});

it('drains bounded pages through one fixed high-water mark', async () => {
  take.mockResolvedValueOnce({ events: [], more: true, throughId: 300 });
  take.mockResolvedValueOnce({ events: [], more: false, throughId: 300 });
  await filterNotifiableMessages([], 'account');
  expect(take).toHaveBeenLastCalledWith('account', 'system', 300, undefined);
});
