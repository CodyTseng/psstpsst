import { act, create, type ReactTestRenderer } from 'react-test-renderer';

import SearchUser from '@/app/(app)/add-contact';
import { AppButton } from '@/components/common/AppButton';
import { ConversationListItem } from '../ConversationListItem';

let mockQuiet = false;
let mockIndicatorsEnabled = true;
const mockRequests = [{
  conversation: { conversationKey: 'stranger', unreadCount: 7, muted: false, updatedAt: 100 },
  lastMessageKind: 14, lastMessageContent: 'hello', lastMessageSenderPubkey: 'stranger',
}];
jest.mock('expo-router', () => ({ router: {} }));
jest.mock('@solar-icons/react-native/category/arrows-action/Linear/DownloadMinimalistic', () => ({ DownloadMinimalistic: () => null }), { virtual: true });
jest.mock('@/components/common/DirectionalChevron', () => ({ DirectionalChevron: () => null }));
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
jest.mock('@/hooks/use-conversations', () => ({ useRequestConversations: () => ({ conversations: mockRequests }) }));
jest.mock('@/hooks/use-quiet-message-requests', () => ({ useQuietMessageRequests: () => ({ quiet: mockQuiet, resolved: true }) }));
jest.mock('@/hooks/use-scrolled', () => ({ useScrolled: () => ({ scrolled: false, scrollProps: {} }) }));
jest.mock('@/hooks/use-focus-after-transition', () => ({ useFocusAfterTransition: () => ({ current: null }) }));
jest.mock('@/stores/active-account.store', () => ({ useActiveAccount: () => 'self' }));
// The global preference hides presentation without changing stored request rows.
jest.mock('@/stores/unread-count.store', () => ({ useUnreadIndicatorsEnabled: () => mockIndicatorsEnabled }));
jest.mock('@/stores/toast.store', () => ({ showToast: jest.fn() }));
jest.mock('@/lib/platform', () => ({ KEYBOARD_AVOIDING_BEHAVIOR: undefined }));
jest.mock('@/lib/gestures', () => ({ closeOpenSwipeable: jest.fn() }));
jest.mock('@/lib/nostr/user-input', () => ({ resolveNostrUserInput: jest.fn() }));
jest.mock('@/lib/nostr/attachment-label', () => ({ attachmentLabel: jest.fn() }));
jest.mock('@/services/conversation/conversation-read.service', () => ({ markAllRequestConversationsAsRead: jest.fn() }));
jest.mock('@/services/conversation/conversation-prefs.service', () => ({ setConversationMuted: jest.fn() }));
jest.mock('@/services/dm/dm.service', () => ({ dmService: {} }));
jest.mock('@/theme', () => ({ spacing: { xs: 4, sm: 8, lg: 16, xl: 24 }, typography: { caption: { lineHeight: 16 } }, useThemeColors: () => ({}) }));
jest.mock('@/components/common/AppScreen', () => ({ AppScreen: ({ children }: { children: React.ReactNode }) => children }));
jest.mock('@/components/common/InteractivePressable', () => ({ InteractivePressable: ({ children }: { children: React.ReactNode }) => children }));
jest.mock('@/components/common/AppButton', () => ({ AppButton: () => null }));
jest.mock('@/components/common/AppInput', () => ({ AppInput: () => null }));
jest.mock('@/components/common/ListRow', () => ({ ListRow: () => null }));
jest.mock('@/components/common/QrScanButton', () => ({ QrScanButton: () => null }));
jest.mock('@/components/common/SectionLabel', () => ({ SectionLabel: () => null }));
jest.mock('@/components/common/ScreenHeader', () => ({ ScreenHeader: () => null, useScreenHeaderClearance: () => 48 }));
jest.mock('../ConversationListItem', () => ({ ConversationListItem: () => null }));

it.each([[true, false], [true, true], [false, false], [false, true]])('request row indicators with enabled=%s, quiet=%s', (enabled, quiet) => {
  mockQuiet = quiet;
  mockIndicatorsEnabled = enabled;
  let renderer!: ReactTestRenderer;
  act(() => { renderer = create(<SearchUser />); });
  const row = renderer.root.findByType(ConversationListItem);
  expect(row.props.unreadCount).toBe(enabled ? 7 : 0);
  expect(row.props.unreadBadgeMode).toBe(quiet ? 'dot' : 'count');
  expect(renderer.root.findAllByType(AppButton).some(button => button.props.label === 'contacts.mark_all_read')).toBe(enabled);
  act(() => renderer.unmount());
});
