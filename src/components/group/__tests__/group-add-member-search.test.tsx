import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { router } from 'expo-router';

import GroupAddMemberScreen from '@/app/(app)/group-add/[key]';
import { AppButton } from '@/components/common/AppButton';
import { AppInput } from '@/components/common/AppInput';
import { InputClearButton } from '@/components/common/InputClearButton';
import { ContactSectionList } from '@/components/contacts/ContactSectionList';
import { ContactListItem } from '@/components/conversation/ContactListItem';
import { resolveNostrUserInput } from '@/lib/nostr/user-input';
import { dmService } from '@/services/dm/dm.service';

jest.mock('expo-router', () => ({
  router: { canGoBack: jest.fn(() => true), back: jest.fn(), push: jest.fn() },
  useLocalSearchParams: () => ({ key: 'group:key' }),
}));
jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
jest.mock('@/components/common/AppButton', () => ({ AppButton: () => null }));
jest.mock('@/components/common/ChromeDivider', () => ({ ChromeDivider: () => null }));
jest.mock('@/components/common/AppInput', () => ({
  AppInput: ({ inputTrailingAccessory }: { inputTrailingAccessory?: React.ReactNode }) =>
    inputTrailingAccessory ?? null,
}));
jest.mock('@/components/common/InputClearButton', () => ({ InputClearButton: () => null }));
jest.mock('@/components/common/AppScreen', () => ({
  AppScreen: ({ children }: { children: React.ReactNode }) => children,
}));
jest.mock('@/components/common/QrScanButton', () => ({ QrScanButton: () => null }));
jest.mock('@/components/common/ScreenHeader', () => ({
  ScreenHeader: () => null,
  useScreenHeaderClearance: () => 0,
}));
jest.mock('@/components/contacts/ContactSectionList', () => ({
  ContactSectionList: () => null,
}));
jest.mock('@/components/conversation/ContactListItem', () => ({
  ContactListItem: ({ trailing }: { trailing?: React.ReactNode }) => trailing ?? null,
}));
jest.mock('@/hooks/use-contact-entries', () => ({
  useContactEntries: () => ({ entries: [], loaded: true }),
}));
jest.mock('@/hooks/use-conversations', () => ({
  useConversation: () => ({
    loaded: true,
    conversation: {
      conversationKey: 'group:key',
      memberPubkeys: ['self', 'member'],
      membersBootstrapEventId: 'bootstrap',
    },
  }),
}));
jest.mock('@/hooks/use-contacts', () => ({
  useContact: () => null,
}));
jest.mock('@/hooks/use-focus-after-transition', () => ({
  useFocusAfterTransition: () => ({ current: null }),
}));
jest.mock('@/hooks/use-scrolled', () => ({
  useScrolled: () => ({ scrolled: false, scrollProps: { onScroll: jest.fn() } }),
}));
jest.mock('@/hooks/use-profile', () => ({
  useProfile: (pubkey: string | null) => pubkey ? {
    pubkey,
    displayName: 'Alice',
    name: null,
    nip05: 'alice@example.com',
    picture: 'https://example.com/alice.png',
  } : null,
}));
jest.mock('@/lib/platform', () => ({ KEYBOARD_AVOIDING_BEHAVIOR: undefined }));
jest.mock('@/lib/nostr/user-input', () => ({ resolveNostrUserInput: jest.fn() }));
jest.mock('@/platform', () => ({
  platform: { confirmationDialog: { confirm: jest.fn(async () => true) } },
}));
jest.mock('@/services/dm/dm.service', () => ({
  dmService: { sendGroupAction: jest.fn(async () => ({ rumorId: 'rumor' })) },
}));
jest.mock('@/services/group/group.service', () => ({
  groupService: { updateLocalRoster: jest.fn() },
}));
jest.mock('@/stores/active-account.store', () => ({
  useActiveAccount: (selector: (state: { activePubkey: string }) => unknown) =>
    selector({ activePubkey: 'self' }),
}));
jest.mock('@/theme', () => ({
  spacing: { sm: 8, md: 12, lg: 16, xl: 24 },
}));

describe('GroupAddMemberScreen user search', () => {
  let renderer: ReactTestRenderer | undefined;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterEach(() => {
    act(() => renderer?.unmount());
    renderer = undefined;
  });

  function renderScreen() {
    act(() => {
      renderer = create(<GroupAddMemberScreen />);
    });
  }

  async function search(value: string) {
    act(() => {
      renderer!.root.findByType(AppInput).props.onChangeText(value);
    });
    await act(async () => {
      renderer!.root.findByType(AppButton).props.onPress();
      await Promise.resolve();
      await Promise.resolve();
    });
  }

  it('resolves the shared user input and invites a non-member', async () => {
    const pubkey = 'a'.repeat(64);
    jest.mocked(resolveNostrUserInput).mockResolvedValue({
      status: 'resolved',
      pubkey,
    });
    renderScreen();
    expect(renderer!.root.findByType(AppInput).props.description).toBe(
      'group.add_member_search_hint',
    );
    expect(renderer!.root.findAllByType(ContactSectionList)).toHaveLength(1);

    await search('alice@example.com');

    expect(resolveNostrUserInput).toHaveBeenCalledWith('alice@example.com');
    expect(dmService.sendGroupAction).not.toHaveBeenCalled();
    expect(renderer!.root.findAllByType(ContactSectionList)).toHaveLength(0);
    const result = renderer!.root.findByType(ContactListItem);
    expect(result.props).toMatchObject({
      counterpartyPubkey: pubkey,
      displayName: 'Alice',
      secondaryName: 'alice@example.com',
      picture: 'https://example.com/alice.png',
    });
    await act(async () => result.props.onPress());
    expect(router.push).toHaveBeenCalledWith(`/profile/${pubkey}`);

    const addButton = renderer!.root.findAllByType(AppButton).find(
      (button) => button.props.label === 'group.add_member',
    );
    const stopPropagation = jest.fn();
    await act(async () => {
      addButton!.props.onPress({ stopPropagation });
      await Promise.resolve();
    });
    expect(stopPropagation).toHaveBeenCalled();
    expect(dmService.sendGroupAction).toHaveBeenCalledWith({
      accountPubkey: 'self',
      conversationKey: 'group:key',
      action: 'invite',
      memberPubkey: pubkey,
    });
    expect(router.back).toHaveBeenCalled();
  });

  it('rejects a user who is already in the group', async () => {
    jest.mocked(resolveNostrUserInput).mockResolvedValue({
      status: 'resolved',
      pubkey: 'member',
    });
    renderScreen();

    await search('member@example.com');

    expect(dmService.sendGroupAction).not.toHaveBeenCalled();
    expect(renderer!.root.findByType(AppInput).props.error).toBe(
      'group.member_already_added',
    );
  });

  it('clears the search result and restores the contact list', async () => {
    jest.mocked(resolveNostrUserInput).mockResolvedValue({
      status: 'resolved',
      pubkey: 'a'.repeat(64),
    });
    renderScreen();
    await search('alice@example.com');

    expect(renderer!.root.findAllByType(ContactSectionList)).toHaveLength(0);
    await act(async () => {
      renderer!.root.findByType(InputClearButton).props.onPress();
    });

    expect(renderer!.root.findByType(AppInput).props.value).toBe('');
    expect(renderer!.root.findAllByType(ContactListItem)).toHaveLength(0);
    expect(renderer!.root.findAllByType(ContactSectionList)).toHaveLength(1);
  });

  it('uses the shared invalid-user error', async () => {
    jest.mocked(resolveNostrUserInput).mockResolvedValue({ status: 'invalid' });
    renderScreen();

    await search('not a user');

    expect(dmService.sendGroupAction).not.toHaveBeenCalled();
    expect(renderer!.root.findByType(AppInput).props.error).toBe('add_contact.invalid');
  });
});
