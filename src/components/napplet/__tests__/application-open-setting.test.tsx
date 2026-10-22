import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { ApplicationOpenSetting } from '../ApplicationOpenSetting';
import { Toggle } from '@/components/common/Toggle';
import { getData, setData } from '@/services/napplet/repository';
import type { ExploreEntry } from '@/services/explore/model';

jest.mock('@/platform', () => ({ platform: { napplet: { tasks: {} } } }));
jest.mock('@/services/napplet/repository', () => ({ getData: jest.fn(async () => null), setData: jest.fn(async () => {}) }));
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
jest.mock('@/components/common/ListGroup', () => ({ ListGroup: ({ children }: { children: React.ReactNode }) => children }));
jest.mock('@/components/common/ListRow', () => ({ ListRow: ({ trailing }: { trailing: React.ReactNode }) => trailing }));
jest.mock('@/components/common/AppText', () => ({ AppText: ({ children }: { children: React.ReactNode }) => children }));
jest.mock('@/components/common/Toggle', () => ({ Toggle: () => null }));
jest.mock('@/theme', () => ({ spacing: { sm: 8 } }));

const website: ExploreEntry = { key: 'https://example.com/page', address: 'https://example.com/page', kind: 'website',
  title: 'Website', description: '', servers: [], required: [], desktopPosition: null, lastUsedAt: null };
let renderer: ReactTestRenderer;
beforeEach(() => { jest.clearAllMocks(); jest.mocked(getData).mockResolvedValue(null); });
afterEach(() => { act(() => renderer?.unmount()); });

it('persists the selected opening mode for this account and page', async () => {
  await act(async () => { renderer = create(<ApplicationOpenSetting entry={website} account="account" />); });
  expect(renderer.root.findByType(Toggle).props.accessibilityLabel).toBe('napplets.default_open_in_new_window');
  expect(renderer.root.findByType(Toggle).props.value).toBe(false);
  await act(async () => { renderer.root.findByType(Toggle).props.onValueChange(true); });
  expect(setData).toHaveBeenCalledWith({ accountPubkey: 'account', appKey: website.address }, 'host', 'open-in-window', 'true');
  expect(renderer.root.findByType(Toggle).props.value).toBe(true);
});

it('rolls back an optimistic switch when saving fails', async () => {
  let fail!: (reason: Error) => void;
  jest.mocked(setData).mockImplementationOnce(() => new Promise((_resolve, reject) => { fail = reject; }));
  await act(async () => { renderer = create(<ApplicationOpenSetting entry={website} account="account" />); });
  act(() => { renderer.root.findByType(Toggle).props.onValueChange(true); });
  expect(renderer.root.findByType(Toggle).props.value).toBe(true);
  expect(renderer.root.findByType(Toggle).props.disabled).toBe(true);
  await act(async () => { fail(new Error('storage-failed')); });
  expect(renderer.root.findByType(Toggle).props.value).toBe(false);
  expect(JSON.stringify(renderer.toJSON())).toContain('napplets.request_failed');
});

it.each(['napp', 'napplet'] as const)('omits the opening preference for %s applications', async kind => {
  await act(async () => { renderer = create(<ApplicationOpenSetting entry={{ ...website, kind }} account="account" />); });
  expect(renderer.toJSON()).toBeNull();
  expect(getData).not.toHaveBeenCalled();
});
