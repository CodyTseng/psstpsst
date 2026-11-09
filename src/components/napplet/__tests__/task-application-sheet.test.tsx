import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { ExploreApplicationSheet } from '../ExploreApplicationSheet';
import { BottomSheet } from '@/components/common/BottomSheet';
import { NappletPanel, NappletPanelActions } from '../NappletPanel';
import { exploreService } from '@/services/explore/service';
import type { ExploreEntry } from '@/services/explore/model';

jest.mock('@/hooks/use-open-publisher', () => ({ useOpenPublisher: () => jest.fn() }));
jest.mock('@/hooks/use-explore-share', () => ({ useExploreShare: () => jest.fn() }));
jest.mock('@/platform', () => ({ platform: {} }));
jest.mock('@/components/common/BottomSheet', () => ({ BottomSheet: () => null }));
jest.mock('@/components/common/AppButton', () => ({ AppButton: () => null }));
jest.mock('@/stores/toast.store', () => ({ showToast: jest.fn() }));
jest.mock('../NappletPanel', () => ({ NappletPanel: () => null, NappletPanelActions: () => null }));
jest.mock('../SigningRequestDetails', () => ({ SigningAccountAvatar: () => null }));
jest.mock('../ApplicationOpenSetting', () => ({ ApplicationOpenSetting: () => null }));
jest.mock('../ApplicationPanel', () => ({ ApplicationPanel: () => null }));
jest.mock('../ApplicationSettings', () => ({ ApplicationSettings: () => null }));
jest.mock('../ApplicationAccessControls', () => ({ ApplicationAccessControls: () => null }));
jest.mock('@/services/explore/service', () => ({ exploreService: { signingSource: () => 'source', reload: jest.fn() } }));
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
jest.mock('@/theme', () => ({ contentWidth: {}, spacing: {} }));

const entry: ExploreEntry = { key: 'site', address: 'https://example.com', kind: 'website', title: 'Site',
  description: '', required: [], servers: [], desktopPosition: null, lastUsedAt: null };
let renderer: ReactTestRenderer;
afterEach(() => { act(() => renderer?.unmount()); jest.clearAllMocks(); });

it.each([true, false])('reloads only the current task after the sheet has closed: current=%s', async current => {
  const reload = jest.fn(async () => {}), onPageChange = jest.fn(), onClosed = jest.fn();
  act(() => { renderer = create(<ExploreApplicationSheet entry={entry} account="account" page="about"
    runtime={{ isCurrent: () => current, reload, configure: async () => {} }} onPageChange={onPageChange} onClosed={onClosed} />); });
  const sheet = renderer.root.findByType(BottomSheet);
  act(() => { sheet.props.fixedFooter.props.onAction('reload'); });
  expect(onPageChange).toHaveBeenCalledWith(null);
  expect(reload).not.toHaveBeenCalled();
  await act(async () => { sheet.props.onClosed(); });
  expect(onClosed).toHaveBeenCalledTimes(1);
  expect(reload).toHaveBeenCalledTimes(current ? 1 : 0);
  expect(exploreService.reload).not.toHaveBeenCalled();
});

it('uses the existing napplet permission panel for release-backed tasks', () => {
  const release = { title: 'Napplet' } as NonNullable<ExploreEntry['release']>;
  act(() => { renderer = create(<ExploreApplicationSheet entry={{ ...entry, kind: 'napplet', release }} account="account" page="settings"
    runtime={{ isCurrent: () => true, reload: async () => {}, configure: async () => {} }} onPageChange={() => {}} />); });
  const sheet = renderer.root.findByType(BottomSheet);
  expect(sheet.props.children[0].type).toBe(NappletPanel);
  expect(sheet.props.children[0].props).toEqual(expect.objectContaining({ release, accountPubkey: 'account', page: 'settings' }));
  expect(sheet.props.fixedFooter).toBeUndefined();
  act(() => renderer.update(<ExploreApplicationSheet entry={entry} account="account" page="about"
    runtime={{ isCurrent: () => true, reload: async () => {}, configure: async () => {} }} onPageChange={() => {}} />));
  expect(renderer.root.findByType(BottomSheet).props.fixedFooter.type).toBe(NappletPanelActions);
});
