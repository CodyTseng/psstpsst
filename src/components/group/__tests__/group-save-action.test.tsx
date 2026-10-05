import { act, create, type ReactTestRenderer } from 'react-test-renderer';

import GroupInfoScreen from '@/app/(app)/group/[key]';

type MockProfileActionProps = { label: string; onPress: () => void };
type MockListRowProps = {
  title: string;
  trailing: React.ReactElement<{
    value: boolean;
    onValueChange: (value: boolean) => void;
  }>;
};

const mockSetGroupSaved: jest.Mock<Promise<void>, [string, string, boolean]> = jest.fn(
  async (_accountPubkey: string, _groupId: string, _saved: boolean) => {},
);
const mockSendGroupAction = jest.fn(async (_options: unknown) => ({ rumorId: 'rumor' }));
const mockConfirm = jest.fn(async (_options: unknown) => true);
const mockProfileAction: jest.Mock<null, [MockProfileActionProps]> = jest.fn(
  (_props: MockProfileActionProps) => null,
);
const mockListRow: jest.Mock<null, [MockListRowProps]> = jest.fn(
  (_props: MockListRowProps) => null,
);
let mockSaved = false;

jest.mock('expo-router', () => ({
  router: { canGoBack: jest.fn(() => true), back: jest.fn(), dismissAll: jest.fn(), push: jest.fn(), replace: jest.fn() },
  useLocalSearchParams: () => ({ key: 'group:key' }),
}));
jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
jest.mock('lucide-react-native/icons/log-out', () => () => null);
jest.mock('lucide-react-native/icons/pencil', () => () => null);
jest.mock('lucide-react-native/icons/user-plus', () => () => null);
jest.mock('@solar-icons/react-native/category/notifications/Linear/Bell', () => ({
  Bell: () => null,
}), { virtual: true });
jest.mock('@solar-icons/react-native/category/notifications/Linear/BellOff', () => ({
  BellOff: () => null,
}), { virtual: true });
jest.mock('@/components/common/AppScreen', () => ({
  AppScreen: ({ children }: { children: React.ReactNode }) => children,
}));
jest.mock('@/components/common/AppText', () => ({ AppText: () => null }));
jest.mock('@/components/common/GroupAvatar', () => ({ GroupAvatar: () => null }));
jest.mock('@/components/common/ListGroup', () => ({
  ListGroup: ({ children }: { children: React.ReactNode }) => children,
}));
jest.mock('@/components/common/ListRow', () => ({
  ListRow: (props: MockListRowProps) => mockListRow(props),
}));
jest.mock('@/components/common/ScreenHeader', () => ({
  ScreenHeader: () => null,
  useScreenHeaderClearance: () => 0,
}));
jest.mock('@/components/common/SectionLabel', () => ({ SectionLabel: () => null }));
jest.mock('@/components/common/Toggle', () => ({ Toggle: () => null }));
jest.mock('@/components/group/GroupMemberRow', () => ({ GroupMemberRow: () => null }));
jest.mock('@/components/profile/ProfileAction', () => ({
  ProfileAction: (props: MockProfileActionProps) => mockProfileAction(props),
}));
jest.mock('@/hooks/use-conversations', () => ({
  useConversation: () => ({
    loaded: true,
    conversation: {
      conversationKey: 'group:key',
      groupId: 'raw-group-id',
      memberPubkeys: ['self', 'member'],
      membersBootstrapEventId: 'bootstrap',
      muted: false,
      name: 'Group',
    },
  }),
}));
jest.mock('@/hooks/use-common-groups', () => ({
  useIsGroupSaved: () => ({ saved: mockSaved, loaded: true }),
}));
jest.mock('@/hooks/use-group-presentation', () => ({
  useGroupPresentation: () => ({ title: 'Group', avatarMembers: [] }),
}));
jest.mock('@/hooks/use-scrolled', () => ({
  useScrolled: () => ({ scrolled: false, scrollProps: {} }),
}));
jest.mock('@/services/dm/dm.service', () => ({
  dmService: { sendGroupAction: (options: unknown) => mockSendGroupAction(options) },
}));
jest.mock('@/services/group/group.service', () => ({ groupService: {} }));
jest.mock('@/services/group/saved-groups.service', () => ({
  setGroupSaved: (accountPubkey: string, groupId: string, saved: boolean) =>
    mockSetGroupSaved(accountPubkey, groupId, saved),
}));
jest.mock('@/services/conversation/conversation-prefs.service', () => ({
  setConversationMuted: jest.fn(),
}));
jest.mock('@/stores/active-account.store', () => ({
  useActiveAccount: (selector: (state: { activePubkey: string }) => unknown) =>
    selector({ activePubkey: 'self' }),
}));
jest.mock('@/stores/drafts.store', () => ({ useDraftsStore: { getState: jest.fn() } }));
jest.mock('@/stores/pending-attachments.store', () => ({
  usePendingAttachmentsStore: { getState: jest.fn() },
}));
jest.mock('@/stores/toast.store', () => ({ showToast: jest.fn() }));
jest.mock('@/theme/icons', () => ({ iconStrokeWidth: { default: 2 } }));
jest.mock('@/theme', () => ({
  spacing: { sm: 8, lg: 16, xl: 24, '2xl': 32 },
  useThemeColors: () => ({ danger: 'danger', text: 'text' }),
}));
jest.mock('@/platform', () => ({
  platform: { confirmationDialog: { confirm: (options: unknown) => mockConfirm(options) } },
}));

describe('group saved-list action', () => {
  let renderer: ReactTestRenderer | undefined;

  afterEach(() => {
    act(() => renderer?.unmount());
    renderer = undefined;
    jest.clearAllMocks();
  });

  it.each([
    { saved: false, next: true },
    { saved: true, next: false },
  ])('sets saved state to $next from the group-list switch', async ({ saved, next }) => {
    mockSaved = saved;
    act(() => {
      renderer = create(<GroupInfoScreen />);
    });
    const row = mockListRow.mock.calls
      .map(([props]) => props)
      .find((props) => props.title === 'group.save_to_contacts');

    expect(row).toBeDefined();
    expect(row!.trailing.props.value).toBe(saved);
    await act(async () => {
      row!.trailing.props.onValueChange(next);
    });
    expect(mockSetGroupSaved).toHaveBeenCalledWith('self', 'raw-group-id', next);
  });

  it('removes the group from contacts after the user leaves', async () => {
    mockSaved = true;
    act(() => {
      renderer = create(<GroupInfoScreen />);
    });
    const leaveAction = mockProfileAction.mock.calls
      .map(([props]) => props)
      .find((props) => props.label === 'group.leave');

    await act(async () => {
      leaveAction!.onPress();
      await Promise.resolve();
    });

    expect(mockSendGroupAction).toHaveBeenCalledWith({
      accountPubkey: 'self',
      conversationKey: 'group:key',
      action: 'remove',
      memberPubkey: 'self',
    });
    expect(mockSetGroupSaved).toHaveBeenCalledWith('self', 'raw-group-id', false);
  });
});
