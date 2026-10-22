import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { ExploreApplicationSheet } from '../ExploreApplicationSheet';
import { platform } from '@/platform';
import { showToast } from '@/stores/toast.store';
import { BottomSheet } from '@/components/common/BottomSheet';
import type { ExploreEntry } from '@/services/explore/model';
import { exploreService } from '@/services/explore/service';
import { ApplicationOpenSetting } from '../ApplicationOpenSetting';
import { ApplicationPanel } from '../ApplicationPanel';

jest.mock('@/platform', () => ({ platform: { urlOpener: { openExternalUrl: jest.fn(async () => true) } } }));
jest.mock('@/hooks/use-open-publisher', () => ({ useOpenPublisher: () => jest.fn() }));
jest.mock('@/hooks/use-explore-share', () => ({ useExploreShare: () => jest.fn() }));
jest.mock('@/services/explore/service', () => ({ exploreService: { isCurrentRun: () => true, signingSource: () => 'https://example.com',
  activate: jest.fn(async () => {}), reset: jest.fn(async () => {}) } }));
jest.mock('@/stores/toast.store', () => ({ showToast: jest.fn() }));
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
jest.mock('@/components/common/BottomSheet', () => ({ BottomSheet: () => null }));
jest.mock('../NappletPanel', () => ({ NappletPanelActions: () => null }));
jest.mock('../SigningRequestDetails', () => ({ SigningAccountAvatar: () => null }));
jest.mock('../ApplicationPanel', () => ({ ApplicationPanel: () => null }));
jest.mock('../ApplicationOpenSetting', () => ({ ApplicationOpenSetting: () => null }));
jest.mock('../ApplicationSettings', () => ({ ApplicationSettings: () => null }));
jest.mock('../ApplicationAccessControls', () => ({ ApplicationAccessControls: () => null }));
jest.mock('@/theme', () => ({ spacing: { lg: 16 }, contentWidth: { focused: 600 } }));

const website: ExploreEntry = { key: 'https://example.com/current?page=2', address: 'https://example.com/current?page=2', kind: 'website',
  title: 'Website', description: '', servers: [], required: [], desktopPosition: null, lastUsedAt: null };

it('shows the webpage preference after its information alongside the browser action', () => {
  let renderer!: ReactTestRenderer;
  act(() => { renderer = create(<ExploreApplicationSheet entry={website} account="account" runId={1}
    page="about" onPageChange={jest.fn()} />); });
  const sheet = renderer.root.findByType(BottomSheet);
  expect(sheet.props.children[0].type).toBe(ApplicationPanel);
  expect(sheet.props.children[1].type).toBe(ApplicationOpenSetting);
  expect(sheet.props.fixedFooter.props.onOpenExternal).toEqual(expect.any(Function));
  act(() => renderer.unmount());
});

it('keeps the opening switch out of permissions', async () => {
  let renderer!: ReactTestRenderer;
  jest.clearAllMocks();
  act(() => { renderer = create(<ExploreApplicationSheet entry={website} account="account" runId={0}
    page="settings" onPageChange={() => {}} />); });
  const content = renderer.root.findByType(BottomSheet).props.children;
  expect(content[0].type).toBe(ApplicationPanel);
  expect(content[1]).toBeNull();
  const settings = content[0].props.settings;
  await act(async () => { await settings.props.onReset(); });
  expect(exploreService.activate).not.toHaveBeenCalled();
  expect(exploreService.reset).toHaveBeenCalledWith(website, 'account');
  act(() => renderer.unmount());
});

beforeEach(() => { jest.clearAllMocks(); jest.mocked(platform.urlOpener.openExternalUrl).mockResolvedValue(true); });

it('opens the current page in the default browser only after its sheet closes', async () => {
  let renderer!: ReactTestRenderer;
  const onPageChange = jest.fn();
  act(() => { renderer = create(<ExploreApplicationSheet entry={website} account="account" runId={1}
    page="about" onPageChange={onPageChange} />); });
  const sheet = renderer.root.findByType(BottomSheet);
  act(() => { sheet.props.fixedFooter.props.onOpenExternal(); });
  expect(onPageChange).toHaveBeenCalledWith(null);
  expect(platform.urlOpener.openExternalUrl).not.toHaveBeenCalled();
  await act(async () => { sheet.props.onClosed(); });
  expect(platform.urlOpener.openExternalUrl).toHaveBeenCalledWith(website.address);
  act(() => renderer.unmount());
});

it.each(['napp', 'napplet', 'nsite'] as const)('omits the browser action for %s without a public webpage URL', kind => {
  let renderer!: ReactTestRenderer;
  act(() => { renderer = create(<ExploreApplicationSheet entry={{ ...website, kind }} account="account" runId={1}
    page="about" onPageChange={jest.fn()} />); });
  expect(renderer.root.findByType(BottomSheet).props.fixedFooter.props.onOpenExternal).toBeUndefined();
  act(() => renderer.unmount());
});

it.each(['unavailable', 'failure'] as const)('shows feedback when the default browser is %s', async result => {
  if (result === 'unavailable') jest.mocked(platform.urlOpener.openExternalUrl).mockResolvedValue(false);
  else jest.mocked(platform.urlOpener.openExternalUrl).mockRejectedValue(new Error('open-failed'));
  let renderer!: ReactTestRenderer;
  act(() => { renderer = create(<ExploreApplicationSheet entry={website} account="account" runId={1}
    page="about" onPageChange={jest.fn()} />); });
  const sheet = renderer.root.findByType(BottomSheet);
  act(() => { sheet.props.fixedFooter.props.onOpenExternal(); });
  await act(async () => { sheet.props.onClosed(); });
  expect(showToast).toHaveBeenCalledWith('napplets.request_failed');
  act(() => renderer.unmount());
});
