import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import type { ShareTarget } from '@/lib/share/share-target';

const mockSheet = jest.fn((_props: { visible: boolean; onConfirm: () => void; onClosed: () => void }) => null);
const mockList = jest.fn((_props: { onSelect: (target: ShareTarget) => void }) => null);
const mockConversations: unknown[] = [];
const mockContacts: unknown[] = [];
jest.mock('react-native-reanimated', () => ({
  useSharedValue: (value: number) => ({ value }), withTiming: (value: number) => value,
}));
jest.mock('@/hooks/use-conversations', () => ({
  useMainInboxConversations: () => ({ conversations: mockConversations, loaded: true }),
}));
jest.mock('@/hooks/use-contact-entries', () => ({
  useContactEntries: () => ({ entries: mockContacts, loaded: true }),
}));
jest.mock('@/hooks/use-scrolled', () => ({ useScrolled: () => ({ scrolled: false, scrollProps: {} }) }));
jest.mock('@/components/share/ShareConfirmSheet', () => ({
  ShareConfirmSheet: (props: Parameters<typeof mockSheet>[0]) => mockSheet(props),
}));
jest.mock('@/components/share/ConversationRecipientList', () => ({
  ConversationRecipientList: (props: Parameters<typeof mockList>[0]) => mockList(props),
}));
jest.mock('@/components/common/AppScreen', () => ({ AppScreen: ({ children }: { children: React.ReactNode }) => children }));
jest.mock('@/components/common/ScreenHeader', () => ({ ScreenHeader: () => null, useScreenHeaderClearance: () => 0 }));
jest.mock('@/components/common/AppButton', () => ({ AppButton: () => null }));
jest.mock('@/components/common/AppInput', () => ({ AppInput: () => null }));
jest.mock('@/components/common/ChromeDivider', () => ({ ChromeDivider: () => null }));
jest.mock('@/components/contacts/ContactSectionList', () => ({ ContactSectionList: () => null }));
jest.mock('@/components/share/SelectedRecipientsRow', () => ({ SelectedRecipientsRow: () => null }));
jest.mock('lucide-react-native/icons/plus', () => () => null);
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
jest.mock('@/theme', () => ({ useThemeColors: () => ({}), spacing: { lg: 16, md: 12, sm: 8 } }));
const { ForwardRecipientScreen } = jest.requireActual<typeof import('../ForwardRecipientScreen')>('../ForwardRecipientScreen');

it('closes the confirmation sheet before dispatching a send or navigation', () => {
  const onConfirm = jest.fn();
  const target: ShareTarget = { conversationKey: 'peer', deliveryKind: 'relay', name: 'Peer' };
  let renderer!: ReactTestRenderer;
  act(() => { renderer = create(<ForwardRecipientScreen accountPubkey="account" title="Forward"
    preview={null} supportedDeliveryKinds={new Set(['relay'])} sending={false} onConfirm={onConfirm} />); });
  act(() => mockList.mock.lastCall![0].onSelect(target));
  expect(mockSheet.mock.lastCall![0].visible).toBe(true);
  act(() => mockSheet.mock.lastCall![0].onConfirm());
  expect(mockSheet.mock.lastCall![0].visible).toBe(false);
  expect(onConfirm).not.toHaveBeenCalled();
  act(() => mockSheet.mock.lastCall![0].onClosed());
  expect(onConfirm).toHaveBeenCalledWith([target]);
  act(() => mockSheet.mock.lastCall![0].onClosed());
  expect(onConfirm).toHaveBeenCalledTimes(1);
  act(() => renderer.unmount());
});
