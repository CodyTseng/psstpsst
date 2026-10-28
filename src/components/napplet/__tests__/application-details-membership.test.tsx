import { act, create, type ReactTestRenderer } from 'react-test-renderer';
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
  act(() => { renderer = create(<ApplicationDetailsMembership entry={entry} account="account" />); });
  expect(renderer.root.findByType(ApplicationMembershipButton).props.added).toBeUndefined();
  mockMembership = { added: true };
  act(() => { renderer.update(<ApplicationDetailsMembership entry={entry} account="account" />); });
  const button = renderer.root.findByType(ApplicationMembershipButton);
  expect(button.props.added).toBe(true);
  await act(async () => { await button.props.onChange(false); });
  expect(mockChange).toHaveBeenCalledWith(entry, false);
  act(() => renderer.unmount());
});
