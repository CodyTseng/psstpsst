import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { View } from 'react-native';
import { ApplicationDetailsMembership } from '../ApplicationDetailsMembership';
import { ApplicationMembershipButton } from '../ApplicationMembershipButton';
import type { ExploreEntry } from '@/services/explore/model';

let mockMembership: { added: boolean | undefined; error?: Error } = { added: undefined };
const mockChange = jest.fn(async () => {});
jest.mock('@/hooks/use-application-membership', () => ({ useApplicationMembership: () => mockMembership }));
jest.mock('@/hooks/use-application-favorite', () => ({ useApplicationFavorite: () => mockChange }));
jest.mock('@/hooks/use-error-toast', () => ({ useErrorToast: jest.fn() }));
jest.mock('../ApplicationMembershipButton', () => ({ ApplicationMembershipButton: 'MembershipButton' }));

it('waits for independent membership and removes an app already saved before Explore loads', async () => {
  const entry = { key: 'saved', kind: 'napplet', desktopPosition: null } as ExploreEntry;
  let renderer!: ReactTestRenderer;
  const render = () => <ApplicationDetailsMembership entry={entry} account="account">
    {(action, ready) => <View testID="membership" accessibilityState={{ busy: !ready }}>{action}</View>}
  </ApplicationDetailsMembership>;
  act(() => { renderer = create(render()); });
  expect(renderer.root.findByType(ApplicationMembershipButton).props.added).toBeUndefined();
  expect(renderer.root.findByProps({ testID: 'membership' }).props.accessibilityState.busy).toBe(true);
  mockMembership = { added: true };
  act(() => { renderer.update(render()); });
  expect(renderer.root.findByProps({ testID: 'membership' }).props.accessibilityState.busy).toBe(false);
  const button = renderer.root.findByType(ApplicationMembershipButton);
  expect(button.props.added).toBe(true);
  await act(async () => { await button.props.onChange(false); });
  expect(mockChange).toHaveBeenCalledWith(entry, false);
  act(() => renderer.unmount());
});
