import { showForwardNotice, dismissForwardNotice, forwardNoticeStore } from '../forward-notice';
import { shareTargetHref } from '@/lib/share/share-target';

const target = { conversationKey: 'peer', deliveryKind: 'relay' as const, name: 'Peer' };

beforeEach(() => forwardNoticeStore.setState({ notice: null }));

it('retains only navigation metadata and ignores a stale dismissal', () => {
  showForwardNotice(1, 'account', 'source', [target]);
  expect(forwardNoticeStore.getState().notice).toEqual({
    id: 1, accountPubkey: 'account', sourceConversationKey: 'source', targets: [target],
  });
  showForwardNotice(2, 'account', 'source', [target]);
  dismissForwardNotice(1);
  expect(forwardNoticeStore.getState().notice?.id).toBe(2);
  dismissForwardNotice(2);
  expect(forwardNoticeStore.getState().notice).toBeNull();
});

it('builds relay, group, and Nearby routes with encoded identifiers and names', () => {
  expect(shareTargetHref(target)).toBe('/chat/peer');
  expect(shareTargetHref({ ...target, conversationKey: 'group:abc', group: true }))
    .toBe('/chat/group%3Aabc');
  expect(shareTargetHref({ ...target, deliveryKind: 'proximity', name: 'A & B' }))
    .toBe('/chat/peer?transport=proximity&name=A%20%26%20B');
});
