import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { router } from 'expo-router';

import NewChat from '@/app/(app)/new-chat';
import NewGroup from '@/app/(app)/new-group';
import { AppButton } from '@/components/common/AppButton';
import { AppInput } from '@/components/common/AppInput';
import { ActionRow } from '@/components/common/ActionRow';
import { IdentityListItem } from '@/components/common/IdentityListItem';
import { ContactSectionList } from '@/components/contacts/ContactSectionList';
import { resolveNostrUserInput } from '@/lib/nostr/user-input';
import { platform } from '@/platform';
import { groupService } from '@/services/group/group.service';

const mockEntries = [{ pubkey: 'account' }, ...Array.from({ length: 9 }, (_, i) => ({ pubkey: `contact-${i}` }))];
let mockLoaded = true;
let mockPreference: 'light' | 'dark' = 'light';

jest.mock('@solar-icons/react-native/category/users/Linear/UsersGroupRounded', () => ({ UsersGroupRounded: () => null }), { virtual: true });
jest.mock('lucide-react-native/icons/chevron-right', () => () => null);

jest.mock('expo-router', () => ({ router: { replace: jest.fn(), push: jest.fn() } }));
jest.mock('react-native-reanimated', () => ({ useSharedValue: (value: number) => ({ value }) }));
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
jest.mock('@/components/common/AppScreen', () => ({ AppScreen: ({ children }: { children: React.ReactNode }) => children }));
jest.mock('@/components/common/AppButton', () => ({ AppButton: () => null }));
jest.mock('@/components/common/AppInput', () => ({ AppInput: () => null }));
jest.mock('@/components/common/AppText', () => ({ AppText: () => null }));
jest.mock('@/components/common/ActionRow', () => ({ ActionRow: () => null }));
jest.mock('@/components/common/IdentityListItem', () => ({ IdentityListItem: () => null }));
jest.mock('@/components/common/ChromeDivider', () => ({ ChromeDivider: () => null }));
jest.mock('@/components/common/QrScanButton', () => ({ QrScanButton: () => null }));
jest.mock('@/components/common/ScreenHeader', () => ({ ScreenHeader: () => null, useScreenHeaderClearance: () => 0 }));
jest.mock('@/components/contacts/ContactSectionList', () => ({
  ContactSectionList: ({ ListHeaderComponent }: { ListHeaderComponent?: React.ReactNode }) => ListHeaderComponent ?? null,
}));
jest.mock('@/hooks/use-contact-entries', () => ({ useContactEntries: () => ({ entries: mockEntries, loaded: mockLoaded }) }));
jest.mock('@/hooks/use-scrolled', () => ({ useScrolled: () => ({ scrolled: false, scrollProps: {} }) }));
jest.mock('@/lib/nostr/user-input', () => ({ resolveNostrUserInput: jest.fn() }));
jest.mock('@/platform', () => ({ platform: { confirmationDialog: { confirm: jest.fn() } } }));
jest.mock('@/services/group/group.service', () => ({ groupService: { createLocalGroup: jest.fn() } }));
jest.mock('@/stores/active-account.store', () => ({
  useActiveAccount: (selector: (state: { activePubkey: string }) => unknown) => selector({ activePubkey: 'account' }),
}));
jest.mock('@/stores/theme.store', () => ({
  useThemeStore: (selector: (state: { accent: 'blue'; preference: 'light' | 'dark' }) => unknown) => selector({ accent: 'blue', preference: mockPreference }),
}));

describe('separate conversation creation tasks', () => {
  let renderer: ReactTestRenderer;
  beforeEach(() => { jest.clearAllMocks(); mockLoaded = true; mockPreference = 'light'; });
  afterEach(() => { act(() => renderer?.unmount()); });

  it('opens a private chat immediately when a contact is tapped', () => {
    act(() => { renderer = create(<NewChat />); });
    const list = renderer.root.findByType(ContactSectionList);
    expect(list.props.selectedPubkeys).toBeUndefined();
    expect(list.props.entries.some((entry: { pubkey: string }) => entry.pubkey === 'account')).toBe(false);
    act(() => { list.props.onSelect('contact-0'); });
    expect(router.replace).toHaveBeenCalledWith('/chat/contact-0');
    expect(groupService.createLocalGroup).not.toHaveBeenCalled();
    expect(renderer.root.findByType(IdentityListItem).props.title).toBe('group.create_title');
    act(() => { renderer.root.findByType(IdentityListItem).props.onPress(); });
    expect(router.push).toHaveBeenCalledWith('/new-group');
  });

  it('resolves typed input through the private-chat action', async () => {
    jest.mocked(resolveNostrUserInput).mockResolvedValue({ status: 'resolved', pubkey: 'resolved-user' });
    act(() => { renderer = create(<NewChat />); });
    act(() => { renderer.root.findByType(AppInput).props.onChangeText('person@example.com'); });
    await act(async () => renderer.root.findByType(AppButton).props.onPress());
    expect(resolveNostrUserInput).toHaveBeenCalledWith('person@example.com');
    expect(router.replace).toHaveBeenCalledWith('/chat/resolved-user');
  });

  it('requires two selected contacts and creates a group instead of a private chat', async () => {
    jest.mocked(groupService.createLocalGroup).mockResolvedValue({ conversationKey: 'group:test', groupId: 'test' });
    act(() => { renderer = create(<NewGroup />); });
    const action = () => renderer.root.findByType(ActionRow).props.confirm;
    const select = (pubkey: string) => renderer.root.findByType(ContactSectionList).props.onSelect(pubkey);
    expect(action().disabled).toBe(true);
    await act(async () => select('contact-0'));
    expect(action().disabled).toBe(true);
    await act(async () => action().onPress());
    expect(groupService.createLocalGroup).not.toHaveBeenCalled();
    await act(async () => select('contact-1'));
    expect(router.replace).not.toHaveBeenCalled();
    expect(action().disabled).toBe(false);
    expect(renderer.root.findAllByType(AppInput)).toHaveLength(0);
    await act(async () => action().onPress());
    expect(groupService.createLocalGroup).toHaveBeenCalledWith('account', ['contact-0', 'contact-1']);
    expect(router.replace).toHaveBeenCalledWith('/chat/group%3Atest');
  });

  it('retains the large-group warning and rejects a declined selection', async () => {
    jest.mocked(platform.confirmationDialog.confirm).mockResolvedValue(false);
    act(() => { renderer = create(<NewGroup />); });
    for (let i = 0; i < 7; i++) {
      await act(async () => renderer.root.findByType(ContactSectionList).props.onSelect(`contact-${i}`));
    }
    expect(platform.confirmationDialog.confirm).not.toHaveBeenCalled();
    await act(async () => renderer.root.findByType(ContactSectionList).props.onSelect('contact-7'));
    expect(platform.confirmationDialog.confirm).toHaveBeenCalledTimes(1);
    expect(renderer.root.findByType(ContactSectionList).props.selectedPubkeys.size).toBe(7);
  });

  it.each(['light', 'dark'] as const)('renders the group picker in %s mode', (preference) => {
    mockPreference = preference;
    act(() => { renderer = create(<NewGroup />); });
    expect(renderer.root.findByType(ContactSectionList).props.entries).toHaveLength(9);
    expect(renderer.root.findByType(ActionRow).props.confirm.label).toBe('group.create_with_count');
  });

  it('keeps group creation disabled while contacts are loading', () => {
    mockLoaded = false;
    act(() => { renderer = create(<NewGroup />); });
    expect(renderer.root.findAllByType(ContactSectionList)).toHaveLength(0);
    expect(renderer.root.findByType(ActionRow).props.confirm.disabled).toBe(true);
  });
});
